import { describe, expect, it } from "vitest";
import { getAddress } from "ethers";
import { SIWE_STATEMENT, buildSiweMessage, readCookie, sessionCookie, type AuthConfig } from "../src/api/auth.js";
import { RateLimiter } from "../src/api/rateLimit.js";

const config: AuthConfig = { domain: "cult.example", origin: "https://cult.example", uri: "https://cult.example", chainIds: [143], secureCookies: true, challengeTtlMs: 300_000, sessionTtlMs: 43_200_000 };

describe("SIWE messages", () => {
  it("follow ERC-4361 with a checksummed address", () => {
    expect(getAddress("0x00000000000000000000000000000000000a11ce")).not.toBe("0x00000000000000000000000000000000000a11ce");
    const message = buildSiweMessage({
      domain: "cult.example", address: "0x00000000000000000000000000000000000a11ce", uri: "https://cult.example", chainId: 143,
      nonce: "ab".repeat(32), issuedAt: "2026-10-20T00:00:00.000Z", expirationTime: "2026-10-20T00:05:00.000Z",
    });
    expect(message).toBe([
      "cult.example wants you to sign in with your Ethereum account:",
      getAddress("0x00000000000000000000000000000000000a11ce"),
      "",
      SIWE_STATEMENT,
      "",
      "URI: https://cult.example",
      "Version: 1",
      "Chain ID: 143",
      `Nonce: ${"ab".repeat(32)}`,
      "Issued At: 2026-10-20T00:00:00.000Z",
      "Expiration Time: 2026-10-20T00:05:00.000Z",
    ].join("\n"));
  });
});

describe("session cookie", () => {
  it("is host-only, HttpOnly and SameSite=Lax, and Secure only when configured", () => {
    const cookie = sessionCookie("t0ken", config, 43_200_000);
    expect(cookie).toBe("cult_session=t0ken; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure");
    expect(cookie).not.toMatch(/Domain=/i);
    expect(sessionCookie("t", { ...config, secureCookies: false }, 0)).toBe("cult_session=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  });

  it("is read from a Cookie header among others", () => {
    expect(readCookie("a=1; cult_session=abc; b=2", "cult_session")).toBe("abc");
    expect(readCookie(undefined, "cult_session")).toBeUndefined();
    expect(readCookie("cult_sessionx=1", "cult_session")).toBeUndefined();
  });
});

describe("rate limiter", () => {
  it("allows the limit per window and key, then resets with the next window", () => {
    const limiter = new RateLimiter(2, 1000);
    expect([limiter.allow("a", 0), limiter.allow("a", 10), limiter.allow("a", 20), limiter.allow("b", 20)]).toEqual([true, true, false, true]);
    expect(limiter.allow("a", 1000)).toBe(true);
  });
});
