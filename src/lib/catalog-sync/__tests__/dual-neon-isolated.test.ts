// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { applyManifest } from "../apply";
import { computeManifestDigest } from "../manifest";
import type { SyncManifest, SyncManifestOperation } from "../types";
import { prisma } from "@/lib/db";

const runtime = process.env.DUAL_NEON_TEST_MODULES;

describe.skipIf(!runtime)("CS-08 staging guard with a private embedded PostgreSQL instance", () => {
  it("pins target and approval, blocks historical edits and drift, then applies and replays exactly once", async () => {
    const load = (part: string) => import(pathToFileURL(resolve(runtime!, part)).href);
    const [{ PGlite }, { PGLiteSocketServer }] = await Promise.all([
      load("@electric-sql/pglite/dist/index.js"),
      load("@electric-sql/pglite-socket/dist/index.js"),
    ]);
    const db = new PGlite();
    const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 2 });
    try {
      await db.exec(readFileSync(join(process.cwd(), "prisma/migrations/20260923_baseline__official/migration.sql"), "utf8"));
      await db.exec(readFileSync(join(process.cwd(), "scripts/dual-neon/website-approval-tables.sql"), "utf8"));
      const actor = { id: randomUUID(), permission: "catalog_sync.apply" };
      const category = randomUUID();
      const product = randomUUID();
      const variant = randomUUID();
      await db.query("INSERT INTO users (id,name,email) VALUES ($1,'Isolated Owner','owner@example.invalid')", [actor.id]);
      await db.query("INSERT INTO categories (id,name,slug) VALUES ($1,'Food','food')", [category]);
      await db.query(`INSERT INTO products (id,name,slug,category_id,product_type,unit,sale_step_grams)
        VALUES ($1,'Rice','rice',$2,'WEIGHT','KG',100)`, [product, category]);
      await db.query("INSERT INTO product_variants (id,product_id,name,price) VALUES ($1,$2,'Rice',1.50)", [variant, product]);
      const { rows: [identity] } = await db.query("SELECT current_database() AS db, (pg_control_system()).system_identifier::text AS sid");
      await server.start();
      const target = new URL(`postgresql://postgres@${server.getServerConn()}/${identity.db}`);
      vi.stubEnv("DATABASE_URL", target.href);
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("CS08_REAL_PRIMARY_ALLOWED", "false");
      vi.stubEnv("CS08_ISOLATED_HOST", target.hostname);
      vi.stubEnv("CS08_ISOLATED_PORT", target.port);
      vi.stubEnv("CS08_ISOLATED_DATABASE", String(identity.db));
      vi.stubEnv("CS08_ISOLATED_SYSTEM_IDENTIFIER", "wrong");
      const operation: SyncManifestOperation = {
        type: "SET_VARIANT_FIELD", entityType: "product_variant", entityId: variant,
        productId: product, field: "price", base: "1.50", proposed: "14.75",
      };
      function freeze(op: SyncManifestOperation): SyncManifest {
        const payload = {
          manifestId: randomUUID(), digest: "", operations: [op], counts: { products: 1, variants: 1, categories: 0, brands: 0 },
          studio: { source: "DRAFT", sourceId: "isolated", revision: 1, generatedAt: new Date().toISOString() },
          sourceBaseline: { id: "isolated", type: "V0" },
          validation: {},
          mode: "full",
        };
        return { ...payload, digest: computeManifestDigest(payload) };
      }
      function approve(manifest: SyncManifest) {
        vi.stubEnv("CS08_ISOLATED_APPROVED_MANIFEST_ID", manifest.manifestId);
        vi.stubEnv("CS08_ISOLATED_APPROVED_DIGEST", manifest.digest);
        vi.stubEnv("CS08_ISOLATED_APPROVED_ACTOR", actor.id);
        vi.stubEnv("CS08_ISOLATED_APPROVED_AT", new Date().toISOString());
      }
      const apply = (rawManifest: SyncManifest, allowRealPrimary = false) =>
        applyManifest({ rawManifest, actor, options: { allowRealPrimary } });
      const intended = freeze(operation);
      expect((await apply(intended, true)).errorCode).toBe("real_primary_blocked");
      expect((await apply(intended)).errorCode).toBe("unverified_target");
      vi.stubEnv("CS08_ISOLATED_SYSTEM_IDENTIFIER", String(identity.sid));
      expect((await apply(intended)).errorCode).toBe("manifest_approval_required");
      expect((await apply(freeze({ ...operation, source: { provenance: "UNVERIFIED" } }))).errorCode).toBe("unverified_operation_blocked");
      const weight = freeze({ type: "SET_PRODUCT_FIELD", entityType: "product", entityId: product,
        field: "sale_step_grams", base: 100, proposed: null });
      approve(weight);
      expect((await apply(weight)).errorCode).toBe("conflict_aborted");
      const drifted = freeze({ ...operation, base: "1.00" });
      approve(drifted);
      expect((await apply(drifted)).errorCode).toBe("conflict_aborted");
      approve(intended);
      expect((await apply({ ...intended, operations: [{ ...operation, proposed: "17.00" }] })).errorCode).toBe("invalid_manifest");
      const first = await apply(intended);
      expect(first).toMatchObject({ ok: true, status: "APPLIED_VERIFIED", receipt: { auditEventCount: 1 } });
      expect(await apply(intended)).toMatchObject({ ok: true, status: "ALREADY_APPLIED", receipt: first.receipt });
      expect((await db.query("SELECT price::text FROM product_variants")).rows).toEqual([{ price: "14.75" }]);
      expect((await db.query("SELECT count(*)::int AS count FROM sync_apply_receipts")).rows).toEqual([{ count: 1 }]);
      expect((await db.query("SELECT count(*)::int AS count FROM audit_logs")).rows).toEqual([{ count: 1 }]);
    } finally {
      if (process.env.DATABASE_URL?.startsWith("postgresql://postgres@127.0.0.1:")) await prisma.$disconnect();
      await server.stop();
      await db.close();
      vi.unstubAllEnvs();
    }
  }, 45000);
});
