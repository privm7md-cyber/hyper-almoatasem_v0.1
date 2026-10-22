// Phase-10 remediation unit tests: the admin session-cookie policy (G07).
//
// The policy is the single place that decides the cookie NAME and whether it
// carries `Secure`. These tests pin the security invariants:
//   * production always uses the `__Host-` prefix AND `Secure`;
//   * a `__Host-` cookie is NEVER issued without `Secure` (browsers reject it);
//   * the local-development cookie is a DIFFERENT name and never `Secure`
//     (plain HTTP on the developer's machine);
//   * a non-production process that is NOT a local, isolated development
//     setup keeps the production cookie (the dev path is never an open
//     fallback).
import { describe, expect, it } from "vitest";
import {
  DEV_SESSION_COOKIE_NAME,
  PROD_SESSION_COOKIE_NAME,
  isLocalDatabaseTarget,
  isProductionDatabaseTarget,
  sessionCookieName,
  sessionCookieOptions,
  sessionCookieSecure,
  isDevSessionCookieAllowed,
} from "@/lib/auth/session-cookie";

const LOCAL_SCRATCH = "postgresql://user:pw@localhost:5432/hyper_almoatasem_scratch";
const LOCAL_PRODUCTION_DB = "postgresql://user:pw@localhost:5432/hyper_almoatasem";
const REMOTE_SCRATCH = "postgresql://user:pw@db.example.com:5432/hyper_almoatasem_scratch";

describe("admin session cookie policy (G07)", () => {
  it("production always uses the __Host- cookie with Secure", () => {
    const env = { NODE_ENV: "production", DATABASE_URL: LOCAL_SCRATCH };
    expect(isDevSessionCookieAllowed(env)).toBe(false);
    expect(sessionCookieName(env)).toBe(PROD_SESSION_COOKIE_NAME);
    expect(sessionCookieSecure(PROD_SESSION_COOKIE_NAME)).toBe(true);
    const opts = sessionCookieOptions(PROD_SESSION_COOKIE_NAME);
    expect(opts.secure).toBe(true);
    expect(opts.httpOnly).toBe(true);
    expect(opts.path).toBe("/");
    expect(opts.sameSite).toBe("lax");
  });

  it("a real local development process uses the separate non-prefixed cookie", () => {
    const env = { NODE_ENV: "development", DATABASE_URL: LOCAL_SCRATCH };
    expect(isDevSessionCookieAllowed(env)).toBe(true);
    expect(sessionCookieName(env)).toBe(DEV_SESSION_COOKIE_NAME);
    expect(DEV_SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(false);
    expect(sessionCookieSecure(DEV_SESSION_COOKIE_NAME)).toBe(false);
    const opts = sessionCookieOptions(DEV_SESSION_COOKIE_NAME);
    expect(opts.secure).toBe(false);
    expect(opts.httpOnly).toBe(true);
    expect(opts.path).toBe("/");
  });

  it("a non-production process on the PRODUCTION dataset keeps the production cookie", () => {
    const env = { NODE_ENV: "development", DATABASE_URL: LOCAL_PRODUCTION_DB };
    expect(isDevSessionCookieAllowed(env)).toBe(false);
    expect(sessionCookieName(env)).toBe(PROD_SESSION_COOKIE_NAME);
    expect(sessionCookieSecure(PROD_SESSION_COOKIE_NAME)).toBe(true);
  });

  it("a non-production process on a REMOTE database keeps the production cookie", () => {
    const env = { NODE_ENV: "development", DATABASE_URL: REMOTE_SCRATCH };
    expect(isDevSessionCookieAllowed(env)).toBe(false);
    expect(sessionCookieName(env)).toBe(PROD_SESSION_COOKIE_NAME);
  });

  it("never issues a __Host- cookie without Secure (browser-enforced invariant)", () => {
    for (const name of [PROD_SESSION_COOKIE_NAME, DEV_SESSION_COOKIE_NAME, "anything"]) {
      const opts = sessionCookieOptions(name);
      if (name.startsWith("__Host-")) expect(opts.secure).toBe(true);
    }
  });

  it("recognises local and production database targets", () => {
    expect(isLocalDatabaseTarget(LOCAL_SCRATCH)).toBe(true);
    expect(isLocalDatabaseTarget(REMOTE_SCRATCH)).toBe(false);
    expect(isLocalDatabaseTarget(undefined)).toBe(false);
    expect(isProductionDatabaseTarget(LOCAL_PRODUCTION_DB)).toBe(true);
    expect(isProductionDatabaseTarget(LOCAL_SCRATCH)).toBe(false);
  });
});
