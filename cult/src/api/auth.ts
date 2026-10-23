import { createHash, randomBytes } from "node:crypto";
import { getAddress, verifyMessage } from "ethers";
import type pg from "pg";

export interface AuthConfig {
  /** Host the site is served from, as shown in the SIWE message (for example "cult.example.com"). */
  readonly domain: string;
  /** Exact origin allowed to make state-changing requests (for example "https://cult.example.com"). */
  readonly origin: string;
  /** URI placed in the SIWE message. */
  readonly uri: string;
  readonly chainIds: readonly number[];
  readonly secureCookies: boolean;
  readonly challengeTtlMs: number;
  readonly sessionTtlMs: number;
}

export const SIWE_STATEMENT = "Sign in to Chog Cult. This proves you control this address. It does not send a transaction or cost gas.";
export const SESSION_COOKIE = "cult_session";

export interface SiweFields {
  readonly domain: string;
  readonly address: string;
  readonly uri: string;
  readonly chainId: number;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expirationTime: string;
}

/** An ERC-4361 message with the EIP-55 address. Login only accepts the exact text the server issued. */
export function buildSiweMessage(fields: SiweFields): string {
  return [
    `${fields.domain} wants you to sign in with your Ethereum account:`,
    getAddress(fields.address),
    "",
    SIWE_STATEMENT,
    "",
    `URI: ${fields.uri}`,
    "Version: 1",
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    `Expiration Time: ${fields.expirationTime}`,
  ].join("\n");
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();

export type AuthResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: "INVALID_INPUT" | "LOGIN_FAILED"; readonly message: string };

export async function createChallenge(pool: pg.Pool, config: AuthConfig, address: string, chainId: number, nowMs: number): Promise<AuthResult<{ message: string }>> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { ok: false, code: "INVALID_INPUT", message: "address must be a 20-byte hex address." };
  if (!config.chainIds.includes(chainId)) return { ok: false, code: "INVALID_INPUT", message: `chainId must be one of ${config.chainIds.join(", ")}.` };
  const nonce = randomBytes(32).toString("hex");
  const message = buildSiweMessage({ domain: config.domain, address, uri: config.uri, chainId, nonce, issuedAt: iso(nowMs), expirationTime: iso(nowMs + config.challengeTtlMs) });
  await pool.query("INSERT INTO auth_challenges (nonce, address, chain_id, message, expires_at) VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))",
    [nonce, address.toLowerCase(), chainId, message, nowMs + config.challengeTtlMs]);
  return { ok: true, value: { message } };
}

export interface NewSession {
  readonly sessionId: string;
  readonly token: string;
  readonly csrfToken: string;
  readonly address: string;
  readonly chainId: number;
  readonly expiresAtMs: number;
}

const failed = { ok: false, code: "LOGIN_FAILED", message: "Sign-in failed. Request a new message and try again." } as const;

/**
 * Verifies a signed challenge and opens a session. The challenge must be unexpired, unused and match the
 * issued message exactly, and the signature must recover its address. It is consumed only on success,
 * inside the same transaction that creates the session, so it can never open two sessions.
 */
export async function verifyLogin(pool: pg.Pool, config: AuthConfig, message: string, signature: string, nowMs: number): Promise<AuthResult<NewSession>> {
  const nonce = /^Nonce: ([0-9a-f]{64})$/m.exec(message)?.[1];
  if (!nonce || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return failed;
  let recovered: string;
  try { recovered = verifyMessage(message, signature).toLowerCase(); } catch { return failed; }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows } = await db.query<{ address: string; chain_id: number; message: string; expires_at: Date; consumed_at: Date | null }>(
      "SELECT address, chain_id, message, expires_at, consumed_at FROM auth_challenges WHERE nonce = $1 FOR UPDATE", [nonce]);
    const challenge = rows[0];
    if (!challenge || challenge.consumed_at || challenge.expires_at.getTime() <= nowMs || challenge.message !== message || challenge.address !== recovered) {
      await db.query("ROLLBACK");
      return failed;
    }
    await db.query("UPDATE auth_challenges SET consumed_at = to_timestamp($2 / 1000.0) WHERE nonce = $1", [nonce, nowMs]);
    const session: NewSession = {
      sessionId: randomBytes(16).toString("hex"), token: randomBytes(32).toString("hex"), csrfToken: randomBytes(32).toString("hex"),
      address: recovered, chainId: challenge.chain_id, expiresAtMs: nowMs + config.sessionTtlMs,
    };
    await db.query(
      `INSERT INTO sessions (id, token_hash, csrf_hash, address, chain_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0))`,
      [session.sessionId, sha256(session.token), sha256(session.csrfToken), session.address, session.chainId, nowMs, session.expiresAtMs]);
    await db.query("COMMIT");
    return { ok: true, value: session };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

export interface Session {
  readonly sessionId: string;
  readonly address: string;
  readonly chainId: number;
  readonly csrfHash: string;
  readonly expiresAtMs: number;
}

export async function findSession(pool: pg.Pool, token: string | undefined, nowMs: number): Promise<Session | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const { rows } = await pool.query<{ id: string; address: string; chain_id: number; csrf_hash: string; expires_at: Date }>(
    "SELECT id, address, chain_id, csrf_hash, expires_at FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > to_timestamp($2 / 1000.0)",
    [sha256(token), nowMs]);
  const row = rows[0];
  return row ? { sessionId: row.id, address: row.address, chainId: row.chain_id, csrfHash: row.csrf_hash, expiresAtMs: row.expires_at.getTime() } : null;
}

export function csrfMatches(session: Session, csrfToken: string | undefined): boolean {
  return typeof csrfToken === "string" && /^[0-9a-f]{64}$/.test(csrfToken) && sha256(csrfToken) === session.csrfHash;
}

export async function revokeSession(pool: pg.Pool, sessionId: string, nowMs: number): Promise<void> {
  await pool.query("UPDATE sessions SET revoked_at = to_timestamp($2 / 1000.0) WHERE id = $1 AND revoked_at IS NULL", [sessionId, nowMs]);
}

export function sessionCookie(token: string, config: AuthConfig, maxAgeMs: number): string {
  // Host-only (no Domain attribute), HttpOnly, SameSite=Lax; Secure outside local development.
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}${config.secureCookies ? "; Secure" : ""}`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}
