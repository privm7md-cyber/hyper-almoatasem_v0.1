import { createHash, randomBytes, randomUUID } from "node:crypto";

const digest = (input) => createHash("sha256").update(input).digest("hex");
const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const retentionDays = { WORKBOOK_UPLOAD: 14, WORKBOOK_EXPORT: 14, BACKUP: 30 };
const maxWorkbookSize = 16 * 1024 * 1024;
const maxBackupSize = 64 * 1024 * 1024;
const grantSeconds = 60;

/**
 * Store accepts a trusted owner context from the session service. The provider
 * exposes putPrivate(key, bytes, contentType) and getPrivate(key) returning a stream.
 * Caller validation must apply worksheet, row, and uncompressed archive bounds.
 */
export function privateFiles({ db, provider, verifyWorkbook, allowBackups = false }) {
  const allowed = (owner) => owner?.role === "OWNER" && typeof owner.ownerId === "string";
  async function store(owner, { bytes, filename, kind }) {
    if (!allowed(owner) || !Object.hasOwn(retentionDays, kind) || (kind === "BACKUP" && !allowBackups)) return null;
    const backup = kind === "BACKUP";
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > (backup ? maxBackupSize : maxWorkbookSize) ||
        typeof filename !== "string" || filename.length < 1 || filename.length > 160 ||
        /[\u0000-\u001f\u007f/\\]/u.test(filename)) throw new Error("Invalid private file");
    if (!backup) {
      if (!filename.toLowerCase().endsWith(".xlsx") || bytes.subarray(0, 4).toString("hex") !== "504b0304") {
        throw new Error("A valid XLSX workbook is required");
      }
      await verifyWorkbook(bytes);
    }
    const id = randomUUID();
    const objectKey = "studio/" + kind.toLowerCase() + "/" + id;
    const sha256 = digest(bytes);
    await db.query(`
      INSERT INTO studio_files.objects (id, owner_id, object_key, filename, kind, byte_length, sha256, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,now() + make_interval(days => $8))
    `, [id, owner.ownerId, objectKey, filename, kind, bytes.length, sha256, retentionDays[kind]]);
    try {
      await provider.putPrivate(objectKey, bytes, backup ? "application/octet-stream" : xlsx);
      await db.query("UPDATE studio_files.objects SET status = 'READY' WHERE id = $1 AND status = 'UPLOADING'", [id]);
    } catch {
      await db.query("UPDATE studio_files.objects SET status = 'FAILED' WHERE id = $1 AND status = 'UPLOADING'", [id]);
      throw new Error("Private file upload did not complete");
    }
    return { id, sha256, byteLength: bytes.length };
  }

  async function issueDownload(owner, id) {
    if (!allowed(owner)) return null;
    const token = randomBytes(32).toString("base64url");
    const { rows: [grant] } = await db.query(`
      INSERT INTO studio_files.download_grants(token_digest, object_id, owner_id, expires_at)
      SELECT $1, id, owner_id, least(expires_at, now() + make_interval(secs => $4)) FROM studio_files.objects
      WHERE id = $2 AND owner_id = $3 AND status = 'READY' AND expires_at > now() AND (kind <> 'BACKUP' OR $5)
      RETURNING expires_at`, [digest(token), id, owner.ownerId, grantSeconds, allowBackups]);
    return grant ? { token, expiresAt: grant.expires_at } : null;
  }

  async function download(owner, token) {
    if (!allowed(owner) || typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const { rows: [file] } = await db.query(`
      DELETE FROM studio_files.download_grants g USING studio_files.objects o
      WHERE g.token_digest = $1 AND g.owner_id = $2 AND o.id = g.object_id AND o.owner_id = g.owner_id
        AND g.expires_at > now() AND o.expires_at > now() AND o.status = 'READY' AND (o.kind <> 'BACKUP' OR $3)
      RETURNING o.object_key, o.filename, o.kind, o.byte_length
    `, [digest(token), owner.ownerId, allowBackups]);
    if (!file) return null;
    const stream = await provider.getPrivate(file.object_key);
    if (!stream) return null;
    const filename = encodeURIComponent(file.filename.toWellFormed()).replace(/['()*]/g, (char) => "%" + char.charCodeAt(0).toString(16));
    return new Response(stream, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "attachment; filename*=UTF-8''" + filename,
        "Content-Type": file.kind === "BACKUP" ? "application/octet-stream" : xlsx,
        "Content-Length": String(file.byte_length),
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return { store, issueDownload, download };
}

// Supply the token for a private store through a server-side secret binding.
// Load the official SDK lazily so local rehearsals require no hosted service.
export async function vercelPrivateObjects(token) {
  if (!token) throw new Error("A private Blob read-write token is required");
  const sdk = "@vercel/blob";
  const { put, get } = await import(sdk);
  return {
    async putPrivate(key, bytes, contentType) {
      await put(key, bytes, { access: "private", token, contentType, addRandomSuffix: false, allowOverwrite: false });
    },
    async getPrivate(key) {
      const result = await get(key, { access: "private", token, useCache: false });
      return result?.statusCode === 200 ? result.stream : null;
    },
  };
}
