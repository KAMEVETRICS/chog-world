import { describe, expect, it } from "vitest";
import { liveConfigFromEnv } from "../src/live/config.js";
import { parseRoster } from "../src/live/roster.js";

const ENV = {
  CULT_DATABASE_URL: "postgres://cult@db.internal/cult", CULT_ORIGIN: "https://cult.example.com", CULT_MANIFEST_PATH: "manifest.json",
  CULT_ROSTER_PATH: "roster.json", CITY_API_URL: "https://city.example.com",
};
const deployment = {
  chainId: 143 as const, registry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", adapter: "0x00000000000000000000000000000000000c4a77",
  collection: "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763", activation: { number: 1n, hash: `0x${"11".repeat(32)}` },
};

describe("live configuration", () => {
  it("accepts a complete HTTPS configuration with safe defaults", () => {
    expect(liveConfigFromEnv(ENV)).toEqual({
      databaseUrl: ENV.CULT_DATABASE_URL, origin: "https://cult.example.com", host: "127.0.0.1", port: 8787, manifestPath: "manifest.json",
      rosterPath: "roster.json", rpcUrl: "https://rpc.monad.xyz", cityUrl: "https://city.example.com", timing: "production", trustedProxies: [],
      soul: { openRouterKey: null, model: null, treasury: null, startBlock: null },
    });
    expect(liveConfigFromEnv({ ...ENV, CULT_MODE: "live", CITY_API_URL: "http://127.0.0.1:8080/" }).cityUrl).toBe("http://127.0.0.1:8080");
    // Without a remote City, City runs in the same server.
    expect(liveConfigFromEnv({ ...ENV, CITY_API_URL: undefined }).cityUrl).toBeNull();
    // Without a roster the server starts empty; holders bring their Chogs in from /city/.
    expect(liveConfigFromEnv({ ...ENV, CULT_ROSTER_PATH: undefined }).rosterPath).toBeNull();
  });

  it("reads Chog Soul settings and needs a start block with a treasury", () => {
    const treasury = "0x00000000000000000000000000000000007EA501";
    expect(liveConfigFromEnv({ ...ENV, OPENROUTER_API_KEY: " sk-test ", SOUL_TREASURY: treasury, SOUL_START_BLOCK: "115000000" }).soul)
      .toEqual({ openRouterKey: "sk-test", model: null, treasury: treasury.toLowerCase(), startBlock: 115000000n });
    expect(() => liveConfigFromEnv({ ...ENV, SOUL_TREASURY: treasury })).toThrow(/SOUL_START_BLOCK/);
    expect(() => liveConfigFromEnv({ ...ENV, SOUL_TREASURY: "treasury.eth", SOUL_START_BLOCK: "1" })).toThrow(/0x address/);
  });

  it("refuses fixture mode and fixture-only settings", () => {
    expect(() => liveConfigFromEnv({ ...ENV, CULT_MODE: "fixture" })).toThrow(/only runs in live mode/);
    expect(() => liveConfigFromEnv({ ...ENV, CULT_DEV_HOLDER: "0x00000000000000000000000000000000000a11ce" })).toThrow(/fixture-only setting/);
  });

  it("refuses an origin that is not exactly an HTTPS origin, and plain-HTTP dependencies", () => {
    expect(() => liveConfigFromEnv({ ...ENV, CULT_ORIGIN: "http://cult.example.com" })).toThrow(/must use HTTPS/);
    expect(() => liveConfigFromEnv({ ...ENV, CULT_ORIGIN: "https://cult.example.com/cult" })).toThrow(/origin only/);
    expect(() => liveConfigFromEnv({ ...ENV, MONAD_MAINNET_RPC_URL: "http://rpc.example.com" })).toThrow(/MONAD_MAINNET_RPC_URL must use HTTPS/);
    expect(() => liveConfigFromEnv({ ...ENV, CITY_API_URL: "http://city.example.com" })).toThrow(/CITY_API_URL must use HTTPS/);
  });

  it("reads the reverse proxy's addresses and ranges, and trusts no one without them", () => {
    expect(liveConfigFromEnv({ ...ENV, CULT_TRUSTED_PROXY: " " }).trustedProxies).toEqual([]);
    expect(liveConfigFromEnv({ ...ENV, CULT_TRUSTED_PROXY: "127.0.0.1" }).trustedProxies).toEqual(["127.0.0.1"]);
    expect(liveConfigFromEnv({ ...ENV, CULT_TRUSTED_PROXY: "10.0.0.0/8, ::1 ,fd00::/8,192.168.1.7/32" }).trustedProxies)
      .toEqual(["10.0.0.0/8", "::1", "fd00::/8", "192.168.1.7/32"]);
  });

  it("refuses a trusted proxy that is a name, a hop count, a malformed range, or everyone", () => {
    for (const value of ["true", "*", "loopback", "proxy.internal", "1", "10.0.0.0/33", "::1/129", "10.0.0.0/08", "10.0.0.0/", "10.0.0.0/8/8", "127.0.0.1,", "[::1]"]) {
      expect(() => liveConfigFromEnv({ ...ENV, CULT_TRUSTED_PROXY: value }), value).toThrow(/is not an IP address or CIDR range/);
    }
    expect(() => liveConfigFromEnv({ ...ENV, CULT_TRUSTED_PROXY: "10.0.0.1, 0.0.0.0/0" })).toThrow('CULT_TRUSTED_PROXY entry "0.0.0.0/0" trusts every address');
    expect(() => liveConfigFromEnv({ ...ENV, CULT_TRUSTED_PROXY: "::/0" })).toThrow(/trusts every address/);
  });

  it("names the first missing setting", () => {
    expect(() => liveConfigFromEnv({ ...ENV, CULT_MANIFEST_PATH: "" })).toThrow("Set CULT_MANIFEST_PATH.");
    expect(() => liveConfigFromEnv({ ...ENV, CULT_DATABASE_URL: undefined })).toThrow("Set CULT_DATABASE_URL.");
  });
});

describe("live roster", () => {
  const entry = { name: "Regent", tokenId: "12", agentId: "4107", traits: { Head: "Crown" } };

  it("builds every identity from the verified deployment", () => {
    const [chog] = parseRoster({ chogs: [entry] }, deployment);
    expect(chog!.identity).toEqual({ chainId: 143, registry: deployment.registry, adapter: deployment.adapter, collection: deployment.collection, tokenId: "12", agentId: "4107" });
    expect(chog!.agentKey).toBe(`143:${deployment.registry}:${deployment.adapter}:${deployment.collection}:12:4107`);
  });

  it("refuses duplicates and malformed entries", () => {
    expect(() => parseRoster({ chogs: [entry, { ...entry, name: "Other", agentId: "4108" }] }, deployment)).toThrow(/duplicate tokenId 12/);
    expect(() => parseRoster({ chogs: [entry, { ...entry, tokenId: "13" }] }, deployment)).toThrow(/duplicate name Regent/);
    expect(() => parseRoster({ chogs: [{ ...entry, tokenId: "012" }] }, deployment)).toThrow(/tokenId must be a decimal string/);
    expect(() => parseRoster({ chogs: [{ ...entry, traits: { Head: 1 } }] }, deployment)).toThrow(/traits must be an object of strings/);
    expect(() => parseRoster({ chogs: [] }, deployment)).toThrow(/at least one Chog/);
  });
});
