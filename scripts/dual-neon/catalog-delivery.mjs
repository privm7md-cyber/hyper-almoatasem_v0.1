import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const id = z.uuid();
const text = (length) => z.string().min(1).max(length);
const timestamp = z.iso.datetime({ offset: true });
const active = { is_active: z.boolean(), deleted_at: timestamp.nullable() };
const nameSlug = { name: text(160), slug: text(180) };
const units = z.enum(["PIECE", "KG", "GRAM", "LITER", "ML"]);
const bodySchemas = {
  products: z.strictObject({
    ...nameSlug, ...active, category_id: id, brand_id: id.nullable(),
    product_type: z.enum(["PIECE", "WEIGHT"]), unit: units, sale_step_grams: z.int32().nullable(),
  }),
  product_variants: z.strictObject({
    ...active, product_id: id, name: text(120), price: z.string().regex(/^\d{1,8}\.\d{2}$/),
    size_value: z.string().regex(/^\d{1,7}\.\d{3}$/).nullable(), size_unit: units.nullable(),
  }),
  product_codes: z.strictObject({
    product_variant_id: id, code: text(64), type: z.enum(["BARCODE", "INTERNAL_CODE"]), is_primary: z.boolean(),
  }),
  categories: z.strictObject({ ...nameSlug, ...active, parent_id: id.nullable(), sort_order: z.int32() }),
  brands: z.strictObject({ ...nameSlug, ...active }),
};
const kind = z.enum(Object.keys(bodySchemas));
const eventSchema = z.strictObject({
  version: z.literal(1), sourceId: id, eventId: id, entityType: kind, entityId: id,
  revision: z.string().regex(/^[1-9]\d{0,18}$/).refine((revision) => BigInt(revision) <= 9223372036854775807n),
  occurredAt: timestamp, body: z.unknown().nonoptional(),
});
const maxBytes = 8192;
const maxClockSkewSeconds = 300;
const maxAttempts = 10;

function signature(secret, sentAt, bytes) {
  if (!Buffer.isBuffer(secret) || secret.byteLength < 32) throw new Error("A dedicated 256-bit signing key is required");
  return createHmac("sha256", secret).update("catalog-mirror/v1\n" + sentAt + "\n").update(bytes).digest();
}

export function signEvent(secret, bytes, now = Date.now()) {
  const sentAt = String(Math.floor(now / 1000));
  return { sentAt, signature: signature(secret, sentAt, bytes).toString("hex") };
}

function verifyEnvelope(secret, signed, bytes, allowedSource, now) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength > maxBytes ||
      !/^\d{10}$/.test(signed.sentAt ?? "") || !/^[a-f0-9]{64}$/.test(signed.signature ?? "") ||
      Math.abs(Math.floor(now / 1000) - Number(signed.sentAt)) > maxClockSkewSeconds ||
      !timingSafeEqual(signature(secret, signed.sentAt, bytes), Buffer.from(signed.signature, "hex"))) {
    return { ok: false, status: 401 };
  }
  try {
    const event = eventSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (event.sourceId !== allowedSource) return { ok: false, status: 403 };
    if (Date.parse(event.occurredAt) > now + maxClockSkewSeconds * 1000) return { ok: false, status: 400 };
    const body = event.body === null ? null : bodySchemas[event.entityType].parse(event.body);
    return { ok: true, event: { ...event, body } };
  } catch {
    return { ok: false, status: 400 };
  }
}

// Use a dedicated connection from the Studio worker pool for the transaction.
export async function receiveEvent(db, { secret, allowedSource, signed, bytes, now = Date.now() }) {
  const envelope = verifyEnvelope(secret, signed, bytes, allowedSource, now);
  if (!envelope.ok) return envelope;
  const event = envelope.event;
  const digest = createHash("sha256").update(bytes).digest("hex");
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL statement_timeout TO '5s'");
    const { rows: [rate] } = await db.query(`
      INSERT INTO website_mirror.rate_windows AS limit_window (source_id, bucket, count)
      VALUES ($1, floor(extract(epoch FROM clock_timestamp()) / 60), 1)
      ON CONFLICT (source_id) DO UPDATE SET bucket = excluded.bucket,
        count = CASE WHEN limit_window.bucket = excluded.bucket THEN limit_window.count + 1 ELSE 1 END
      WHERE limit_window.bucket <> excluded.bucket OR limit_window.count < 300
      RETURNING count`, [event.sourceId]);
    if (!rate) {
      await db.query("ROLLBACK");
      return { ok: false, status: 429 };
    }
    const { rows: [saved] } = await db.query(`
      SELECT digest, outcome, revision FROM website_mirror.receipts
      WHERE source_id = $1 AND (event_id = $2 OR revision = $3)
      ORDER BY (event_id = $2) DESC LIMIT 1`, [event.sourceId, event.eventId, event.revision]);
    if (saved) {
      await db.query("COMMIT");
      return saved.digest === digest
        ? { ok: true, status: 200, outcome: "duplicate", originalOutcome: saved.outcome }
        : { ok: false, status: 409 };
    }
    const { rows } = await db.query(`
      INSERT INTO website_mirror.entities AS entity
        (source_id, entity_type, entity_id, revision, body, occurred_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (source_id, entity_type, entity_id) DO UPDATE
        SET revision = excluded.revision, body = excluded.body,
            occurred_at = excluded.occurred_at, received_at = now()
      WHERE entity.revision < excluded.revision
      RETURNING revision`, [
      event.sourceId, event.entityType, event.entityId, event.revision, event.body, event.occurredAt,
    ]);
    const outcome = rows.length ? "applied" : "stale";
    await db.query(`
      INSERT INTO website_mirror.receipts (source_id, event_id, revision, digest, outcome) VALUES ($1, $2, $3, $4, $5)`,
    [event.sourceId, event.eventId, event.revision, digest, outcome]);
    await db.query("COMMIT");
    return { ok: true, status: 200, outcome };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function claimBatch(db, batchSize = 25) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) throw new Error("Invalid delivery batch size");
  const lease = randomUUID();
  await db.query(`UPDATE catalog_feed.outbox SET dead_at = now()
    WHERE delivered_at IS NULL AND dead_at IS NULL AND attempts >= $1 AND available_at <= now()`, [maxAttempts]);
  const { rows } = await db.query(`
    WITH claimed AS (
      SELECT revision FROM catalog_feed.outbox
      WHERE delivered_at IS NULL AND dead_at IS NULL AND available_at <= now() AND attempts < $3
      ORDER BY revision LIMIT $1 FOR UPDATE SKIP LOCKED
    )
    UPDATE catalog_feed.outbox AS event
    SET attempts = attempts + 1, available_at = now() + interval '180 seconds', lease_id = $2
    FROM claimed WHERE event.revision = claimed.revision
    RETURNING event.revision::text, event.event_id, event.source_id, event.entity_type,
      event.entity_id, event.body::text AS body, event.occurred_at, event.attempts
  `, [batchSize, lease, maxAttempts]);
  return { rows, lease };
}

export function encodeEvent(row) {
  return Buffer.from(JSON.stringify({
    version: 1, eventId: row.event_id, sourceId: row.source_id, entityType: row.entity_type,
    entityId: row.entity_id, revision: row.revision, occurredAt: new Date(row.occurred_at).toISOString(),
    body: row.body === null ? null : JSON.parse(row.body),
  }));
}

export async function completeDelivery(db, row, lease, status) {
  const delivered = status >= 200 && status < 300;
  const permanentlyFailed = [400, 403, 409].includes(status) || row.attempts >= maxAttempts;
  const backoff = Math.min(3600, 5 * 2 ** (row.attempts - 1));
  const result = await db.query(`
    UPDATE catalog_feed.outbox
    SET delivered_at = CASE WHEN $3 THEN now() END,
        dead_at = CASE WHEN NOT $3 AND $4 THEN now() END,
        available_at = now() + make_interval(secs => $5), lease_id = NULL
    WHERE revision = $1 AND lease_id = $2 AND delivered_at IS NULL AND dead_at IS NULL`,
  [row.revision, lease, delivered, permanentlyFailed, backoff]);
  return (result.rowCount ?? result.affectedRows) === 1;
}

export async function catalogWebhook(request, { pool, secret, allowedSource }) {
  const response = (status, body) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "POST") return response(405, { ok: false });
  if (request.headers.get("content-type") !== "application/json" || !request.body) {
    return response(415, { ok: false });
  }
  if (Number(request.headers.get("content-length")) > maxBytes) return response(413, { ok: false });
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return response(413, { ok: false });
      }
      chunks.push(value);
    }
  } catch {
    return response(400, { ok: false });
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  const signed = {
    sentAt: request.headers.get("x-catalog-sent-at"),
    signature: request.headers.get("x-catalog-signature"),
  };
  let client;
  try {
    // Reject unauthenticated requests before acquiring a database connection.
    const envelope = verifyEnvelope(secret, signed, bytes, allowedSource, Date.now());
    if (!envelope.ok) return response(envelope.status, { ok: false });
    client = await pool.connect();
    const result = await receiveEvent(client, { secret, allowedSource, signed, bytes });
    return response(result.status, { ok: result.ok, outcome: result.outcome });
  } catch {
    return response(503, { ok: false });
  } finally {
    client?.release();
  }
}

// Invoke once from a durable worker. The source pool is dedicated to outbox delivery.
export async function deliverCatalogBatch(db, { endpoint, secret, protectionBypass, send = fetch }) {
  const destination = new URL(endpoint);
  if (destination.protocol !== "https:" || destination.username || destination.password || destination.search || destination.hash) {
    throw new Error("An exact HTTPS Studio webhook URL is required");
  }
  const { rows, lease } = await claimBatch(db);
  const results = [];
  for (const row of rows) {
    const bytes = encodeEvent(row);
    const signed = signEvent(secret, bytes);
    let status = 503;
    try {
      const response = await send(destination, {
        method: "POST", body: bytes, redirect: "error", signal: AbortSignal.timeout(5000),
        headers: {
          "content-type": "application/json",
          "x-catalog-sent-at": signed.sentAt,
          "x-catalog-signature": signed.signature,
          ...(protectionBypass ? { "x-vercel-protection-bypass": protectionBypass } : {}),
        },
      });
      // A proxy or login page returning 200 must not acknowledge the event.
      status = response.status;
      if (response.ok) {
        const result = await response.json();
        status = result.ok === true && ["applied", "stale", "duplicate"].includes(result.outcome) ? 200 : 503;
      } else {
        await response.body?.cancel();
      }
    } catch {
      status = 503;
    }
    const acknowledged = await completeDelivery(db, row, lease, status);
    results.push({ eventId: row.event_id, revision: row.revision, status, acknowledged });
  }
  return results;
}

// Base and proposal must come from the same recorded editorial operation.
export function compareField({ base, website, proposal, pending, missing = false }) {
  if (!pending) return "MIRRORED";
  if (missing || base === undefined || website === undefined) return "REVIEW_REQUIRED";
  if (website === proposal) return "ALREADY_CURRENT";
  return website === base ? "PENDING_APPROVAL" : "CONFLICTED";
}
