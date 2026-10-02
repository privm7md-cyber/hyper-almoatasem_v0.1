/**
 * Central session-timezone normalization for the PostgreSQL connection.
 *
 * Root cause (proven live on PG 18.4 / Prisma 7.10 / @prisma/adapter-pg):
 * Prisma serialises JavaScript `Date` parameters WITHOUT an offset, and
 * PostgreSQL reads an offset-less timestamp literal in the *session* time
 * zone. On a non-UTC server (`TimeZone = Africa/Cairo`, +02/+03 DST) every
 * Date-bound TIMESTAMPTZ written through Prisma was therefore stored shifted
 * by the server UTC offset (-10 800 s in summer), and Prisma's own reads
 * mirrored the same shift (the documented CC-1 "decode shift"). Consequences:
 * promotion/coupon windows fired hours early or never, auth-token TTLs were
 * inflated, and keyset cursors only stayed consistent because the two shifts
 * cancelled (fragile, DST-unsafe).
 *
 * Fix: pin the session to UTC for every pooled connection, so offset-less
 * literals are read as UTC and the offsets cancel nowhere. `pg` sends
 * `options` in the startup packet, so this applies to every connection the
 * pool opens. Business clocks remain SQL-side (`now()`); nothing here reads a
 * process-local wall clock.
 *
 * Deliberately strips any `options` value coming from the URL: node-postgres
 * lets connection-string parameters override the config object, so a stray
 * `?options=-c timezone=…` in DATABASE_URL would silently defeat this pin.
 * Non-timezone options are preserved.
 */

const TIMEZONE_OPTION_RE = /^timezone\s*=/i;

/** Build the startup `options` string with `timezone=UTC` pinned. */
function pinTimezone(existing: string): string {
  const tokens = existing.split(/\s+/).filter((token) => token.length > 0);
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "-c") {
      const next = tokens[i + 1];
      if (next !== undefined && TIMEZONE_OPTION_RE.test(next)) {
        i++;
        continue;
      }
      kept.push(token);
      continue;
    }
    if (TIMEZONE_OPTION_RE.test(token)) continue;
    kept.push(token);
  }
  kept.push("-c", "timezone=UTC");
  return kept.join(" ");
}

/**
 * Return `url` with a UTC-pinned session `options` parameter. The rest of the
 * URL (credentials, sslmode, schema, …) is preserved byte-for-byte: no
 * re-encoding of the password, no reordering of unrelated parameters.
 */
export function withUtcSession(url: string): string {
  const q = url.indexOf("?");
  const head = q === -1 ? url : url.slice(0, q);
  const raw = q === -1 ? "" : url.slice(q + 1);
  const parts = raw.length > 0 ? raw.split("&") : [];
  const kept: string[] = [];
  let existingOptions = "";
  for (const part of parts) {
    if (/^options=/i.test(part)) {
      existingOptions += `${decodeURIComponent(part.slice("options=".length))} `;
      continue;
    }
    kept.push(part);
  }
  kept.push(`options=${encodeURIComponent(pinTimezone(existingOptions))}`);
  return `${head}?${kept.join("&")}`;
}
