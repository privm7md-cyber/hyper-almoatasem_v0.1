// @vitest-environment node
// G5-A / D-3: HMAC-bound phone bucket key verification suite.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REG_RATE_LIMIT_PHONE_SECRET_NAME,
  isRegPhoneSecretValid,
  regPhoneBucketKey,
  resolveRegPhoneSecret,
} from "../reg-phone-bucket";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reg-phone-bucket (G5-A / D-3 HMAC phone rate-limit key lifecycle)", () => {
  it("fails closed when REG_RATE_LIMIT_PHONE_SECRET is missing or blank", () => {
    vi.stubEnv(REG_RATE_LIMIT_PHONE_SECRET_NAME, "");
    expect(isRegPhoneSecretValid()).toBe(false);
    expect(() => resolveRegPhoneSecret()).toThrow(/not configured/i);
    expect(() => regPhoneBucketKey("201012345678")).toThrow(/not configured/i);

    vi.stubEnv(REG_RATE_LIMIT_PHONE_SECRET_NAME, "   ");
    expect(isRegPhoneSecretValid()).toBe(false);
    expect(() => regPhoneBucketKey("201012345678")).toThrow(/not configured/i);
  });

  it("fails closed when REG_RATE_LIMIT_PHONE_SECRET is shorter than 32 bytes", () => {
    vi.stubEnv(REG_RATE_LIMIT_PHONE_SECRET_NAME, "too-short-secret-under-32-bytes");
    expect(isRegPhoneSecretValid()).toBe(false);
    expect(() => resolveRegPhoneSecret()).toThrow(/too short/i);
    expect(() => regPhoneBucketKey("201012345678")).toThrow(/too short/i);
  });

  it("accepts a 64-char hex secret (32 bytes) and never falls back to plain SHA-256", () => {
    const hexSecret = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    vi.stubEnv(REG_RATE_LIMIT_PHONE_SECRET_NAME, hexSecret);

    expect(isRegPhoneSecretValid()).toBe(true);
    const key = regPhoneBucketKey("201012345678");
    expect(key).toMatch(/^reg:cust-acct:[0-9a-f]{64}$/);

    // Must never equal plain unkeyed SHA-256
    const plainSha = createHash("sha256").update("201012345678", "utf8").digest("hex");
    expect(key).not.toBe(`reg:cust-acct:${plainSha}`);

    // Deterministic within the same secret
    expect(regPhoneBucketKey("201012345678")).toBe(key);
  });

  it("rotates cleanly: changing the secret produces a disjoint bucket namespace", () => {
    vi.stubEnv(
      REG_RATE_LIMIT_PHONE_SECRET_NAME,
      "1111111111111111111111111111111111111111111111111111111111111111",
    );
    const beforeRotation = regPhoneBucketKey("201012345678");

    vi.stubEnv(
      REG_RATE_LIMIT_PHONE_SECRET_NAME,
      "2222222222222222222222222222222222222222222222222222222222222222",
    );
    const afterRotation = regPhoneBucketKey("201012345678");

    expect(beforeRotation).not.toBe(afterRotation);
  });
});
