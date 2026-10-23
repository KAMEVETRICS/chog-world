// Configuration for the public (live) Cult server. Everything is read from the environment once and
// checked here; anything that belongs to fixture mode, or would weaken a public deployment, is refused.
import { isIP } from "node:net";

/** Monad mainnet. The live server serves no other chain. */
export const LIVE_CHAIN_ID = 143;

export interface LiveConfig {
  readonly databaseUrl: string;
  /** Exact public origin, e.g. https://cult.example.com. SIWE domain and cookie checks use it. */
  readonly origin: string;
  readonly host: string;
  readonly port: number;
  readonly manifestPath: string;
  /** Chogs to admit at start (Cult and City). Null starts empty: holders bring their own Chogs in from /city/. */
  readonly rosterPath: string | null;
  readonly rpcUrl: string;
  /** A separately hosted Chog City to follow; null runs City in this server. */
  readonly cityUrl: string | null;
  readonly timing: "production" | "demo";
  /** Chog Soul: AI is on only with an OpenRouter key; $CHOG top-ups open only with a treasury address. */
  readonly soul: { readonly openRouterKey: string | null; readonly model: string | null; readonly treasury: string | null; readonly startBlock: bigint | null };
  /** Reverse-proxy addresses or CIDR ranges whose X-Forwarded-For is believed. Empty trusts no one. */
  readonly trustedProxies: readonly string[];
}

const FIXTURE_ONLY = ["CULT_DEV_HOLDER"] as const;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const CIDR_PREFIX = /^(0|[1-9][0-9]{0,2})$/;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

function url(value: string, name: string): URL {
  try { return new URL(value); } catch { throw new Error(`${name} must be a URL.`); }
}

/** CULT_TRUSTED_PROXY: comma-separated IP addresses or CIDR ranges. Names, hop counts and /0 are refused. */
function trustedProxies(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(",").map((raw) => {
    const entry = raw.trim();
    const slash = entry.indexOf("/");
    const address = slash === -1 ? entry : entry.slice(0, slash);
    const prefix = slash === -1 ? undefined : entry.slice(slash + 1);
    const version = isIP(address);
    if (!version || (prefix !== undefined && !(CIDR_PREFIX.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128)))) {
      throw new Error(`CULT_TRUSTED_PROXY entry "${entry}" is not an IP address or CIDR range, like 127.0.0.1 or 10.0.0.0/8.`);
    }
    if (prefix === "0") throw new Error(`CULT_TRUSTED_PROXY entry "${entry}" trusts every address; name only the reverse proxy's address or subnet.`);
    return entry;
  });
}

/** Reads and checks the live configuration; throws with the first problem found. */
export function liveConfigFromEnv(env: NodeJS.ProcessEnv): LiveConfig {
  if (env.CULT_MODE !== undefined && env.CULT_MODE !== "live") throw new Error(`CULT_MODE is "${env.CULT_MODE}"; the live server only runs in live mode. Use serve:fixture for local fixtures.`);
  for (const name of FIXTURE_ONLY) {
    if (env[name] !== undefined) throw new Error(`${name} is a fixture-only setting; unset it for the live server.`);
  }

  const origin = url(required(env, "CULT_ORIGIN"), "CULT_ORIGIN");
  if (origin.protocol !== "https:") throw new Error("CULT_ORIGIN must use HTTPS: session cookies are Secure in live mode.");
  if (origin.origin !== required(env, "CULT_ORIGIN").replace(/\/$/, "") || origin.username || origin.password) {
    throw new Error("CULT_ORIGIN must be an origin only, like https://cult.example.com (no path, query or credentials).");
  }

  const rpcUrl = env.MONAD_MAINNET_RPC_URL?.trim() || "https://rpc.monad.xyz";
  if (url(rpcUrl, "MONAD_MAINNET_RPC_URL").protocol !== "https:") throw new Error("MONAD_MAINNET_RPC_URL must use HTTPS.");

  const cityText = env.CITY_API_URL?.trim();
  const cityUrl = cityText ? url(cityText, "CITY_API_URL") : null;
  if (cityUrl && cityUrl.protocol !== "https:" && !(cityUrl.protocol === "http:" && LOOPBACK.has(cityUrl.hostname))) {
    throw new Error("CITY_API_URL must use HTTPS, or HTTP to a loopback address behind the same proxy.");
  }

  const treasuryText = env.SOUL_TREASURY?.trim();
  if (treasuryText && !/^0x[0-9a-fA-F]{40}$/.test(treasuryText)) throw new Error("SOUL_TREASURY must be the treasury's 0x address.");
  const startText = env.SOUL_START_BLOCK?.trim();
  if (startText && !/^(0|[1-9][0-9]{0,18})$/.test(startText)) throw new Error("SOUL_START_BLOCK must be a block number.");
  if (treasuryText && !startText) throw new Error("Set SOUL_START_BLOCK with SOUL_TREASURY: the first block to read $CHOG top-ups from.");

  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a TCP port number.");
  const timing = env.CULT_TIMING ?? "production";
  if (timing !== "production" && timing !== "demo") throw new Error("CULT_TIMING must be production or demo.");

  return {
    databaseUrl: required(env, "CULT_DATABASE_URL"),
    origin: origin.origin,
    // Behind a reverse proxy by default; set CULT_HOST to listen elsewhere.
    host: env.CULT_HOST?.trim() || "127.0.0.1",
    port,
    manifestPath: required(env, "CULT_MANIFEST_PATH"),
    rosterPath: env.CULT_ROSTER_PATH?.trim() || null,
    rpcUrl,
    cityUrl: cityUrl ? cityUrl.toString().replace(/\/$/, "") : null,
    timing,
    trustedProxies: trustedProxies(env.CULT_TRUSTED_PROXY),
    soul: {
      openRouterKey: env.OPENROUTER_API_KEY?.trim() || null, model: env.SOUL_MODEL?.trim() || null,
      treasury: treasuryText ? treasuryText.toLowerCase() : null, startBlock: startText ? BigInt(startText) : null,
    },
  };
}
