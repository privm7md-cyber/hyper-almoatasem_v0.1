// @vitest-environment node
// P12-08 D01 — Dedicated Privacy Redaction Worker Preflight & Secret-Safety Tests.
import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workerModuleUrl = pathToFileURL(
  path.resolve(__dirname, "../../../../scripts/privacy-redaction-worker.mjs"),
).href;

describe("privacy-redaction-worker — inactive import & fail-closed preflight", () => {
  it("never auto-starts on module import and strips secret/PII keys from structured logs", async () => {
    const mod = (await import(workerModuleUrl)) as {
      sanitizeWorkerLogFields: (event: string, fields: Record<string, unknown>) => Record<string, unknown>;
      normalizeWorkerErrorCode: (err: unknown) => string;
      parseWorkerArgs: (argv: string[]) => { flags: Set<string>; values: Map<string, string> };
    };

    const parsed = mod.parseWorkerArgs(["--once", "--max-tasks", "10", "--recover-task", "abc"]);
    expect(parsed.flags.has("once")).toBe(true);
    expect(parsed.values.get("max-tasks")).toBe("10");
    expect(parsed.values.get("recover-task")).toBe("abc");

    const sanitized = mod.sanitizeWorkerLogFields("task.failed", {
      taskId: "00000000-0000-4000-8000-000000000001",
      errorCode: "PG_42501",
      password: "never-log-password",
      databaseUrl: "postgresql://secret",
      customerEmail: "secret@example.test",
      phone: "01012345678",
      firstName: "أحمد",
    });
    expect(sanitized.taskId).toBe("00000000-0000-4000-8000-000000000001");
    expect(sanitized.errorCode).toBe("PG_42501");
    const json = JSON.stringify(sanitized);
    expect(json).not.toContain("never-log-password");
    expect(json).not.toContain("postgresql://secret");
    expect(json).not.toContain("secret@example.test");
    expect(json).not.toContain("01012345678");
    expect(json).not.toContain("أحمد");

    expect(mod.normalizeWorkerErrorCode({ code: "42501" })).toBe("PG_42501");
    expect(mod.normalizeWorkerErrorCode({ workerCode: "SIMULATED_WORKER_CRASH" })).toBe("SIMULATED_WORKER_CRASH");
    expect(mod.normalizeWorkerErrorCode(new Error("raw stack sensitive"))).toBe("WORKER_EXECUTION_ERROR");
  });

  it("refuses missing PRIVACY_WORKER_DATABASE_URL and refuses sharing DATABASE_URL", async () => {
    const mod = (await import(workerModuleUrl)) as {
      runPrivacyWorkerCli: (argv: string[], env: NodeJS.ProcessEnv) => Promise<number>;
    };
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await mod.runPrivacyWorkerCli(["--once"], { NODE_ENV: "test" })).toBe(1);
      expect(
        await mod.runPrivacyWorkerCli(["--once"], {
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://same@127.0.0.1:55433/db",
          PRIVACY_WORKER_DATABASE_URL: "postgresql://same@127.0.0.1:55433/db",
        }),
      ).toBe(1);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("verifyWorkerConnectionSafety rejects superuser, unauthorized Primary DB, and excess table SELECT privileges", async () => {
    const mod = (await import(workerModuleUrl)) as {
      verifyWorkerConnectionSafety: (
        pool: { query: (sql: string) => Promise<{ rows: unknown[] }> },
        env: NodeJS.ProcessEnv,
      ) => Promise<{ role: string; database: string }>;
    };

    // 1) Superuser rejected
    await expect(
      mod.verifyWorkerConnectionSafety(
        {
          query: async () => ({
            rows: [
              {
                current_user: "postgres",
                database: "hyper_d01_h2_int",
                is_super: true,
                can_read_audit: true,
                can_read_customers: true,
                can_exec_redact: true,
              },
            ],
          }),
        },
        { NODE_ENV: "test" },
      ),
    ).rejects.toMatchObject({ workerCode: "FORBIDDEN_SUPERUSER_ROLE" });

    // 2) Production DB without ALLOW_PRODUCTION_PRIVACY_WORKER=1 rejected
    await expect(
      mod.verifyWorkerConnectionSafety(
        {
          query: async () => ({
            rows: [
              {
                current_user: "hyper_privacy_worker",
                database: "hyper_almoatasem",
                is_super: false,
                can_read_audit: false,
                can_read_customers: false,
                can_exec_redact: true,
              },
            ],
          }),
        },
        { NODE_ENV: "production" },
      ),
    ).rejects.toMatchObject({ workerCode: "PRODUCTION_DB_NOT_AUTHORIZED" });

    // 3) Excess SELECT on audit_logs/customers (e.g. if misconfigured with hyper_app) rejected
    await expect(
      mod.verifyWorkerConnectionSafety(
        {
          query: async () => ({
            rows: [
              {
                current_user: "hyper_app",
                database: "hyper_d01_h2_int",
                is_super: false,
                can_read_audit: true,
                can_read_customers: true,
                can_exec_redact: true,
              },
            ],
          }),
        },
        { NODE_ENV: "test" },
      ),
    ).rejects.toMatchObject({ workerCode: "EXCESS_WORKER_PRIVILEGES" });
  });
});
