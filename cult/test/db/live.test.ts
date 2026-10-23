// The live start path end to end: a local EVM on chain 143 with the real adapter, the test database and
// a stand-in City. Checks the verified manifest, live ownership in holder actions, chain 143 sign-in with
// Secure cookies at the configured origin, and what the live server refuses to start with.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Contract, JsonRpcSigner } from "ethers";
import { PgCult } from "../../src/db/pgCult.js";
import { FixtureChainReader } from "../../src/fixture/chainReader.js";
import { FakeCityFeed } from "../../src/fixture/cityFeed.js";
import { FakeCityServer } from "../../src/fixture/fakeCityServer.js";
import { FIXTURE_CHOGS } from "../../src/fixture/chogs.js";
import type { LiveConfig } from "../../src/live/config.js";
import { startLive, type LiveServer } from "../../src/live/start.js";
import { makeAgentKey } from "../../src/shared/identity.js";
import { genesisTraits } from "../../src/citysim/world.js";
import { startLocalEvm, type LocalEvm } from "../chain/localEvm.js";
import { DATABASE_URL, freshSchema } from "./helpers.js";

const describeDb = DATABASE_URL ? describe : describe.skip;
const ORIGIN = "https://cult.test";
const TRAITS = { Background: "Mint", Aura: "Royal Aura", Body: "Kings Robe", Mouth: "Smile", Eyes: "Flat", Head: "Crown", Tier: "Common" };

let evm: LocalEvm;
let city: FakeCityServer;
let dir: string;
let agents: Record<string, string>;
const servers: LiveServer[] = [];

const write = (name: string, value: unknown) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };

async function config(overrides: Partial<LiveConfig> = {}, schema?: string): Promise<LiveConfig> {
  const searchPath = schema ?? (await freshSchema({ migrated: false })).schema;
  return {
    databaseUrl: `${DATABASE_URL}?options=-c%20search_path%3D${searchPath}`, origin: ORIGIN, host: "127.0.0.1", port: 0,
    manifestPath: write("manifest.json", evm.manifest),
    rosterPath: write("roster.json", { chogs: [{ name: "Regent", tokenId: "1", agentId: agents["1"], traits: TRAITS }, { name: "Ember", tokenId: "2", agentId: agents["2"], traits: TRAITS }] }),
    rpcUrl: evm.url, cityUrl: city.url, timing: "production", trustedProxies: [],
    soul: { openRouterKey: null, model: null, treasury: null, startBlock: null }, ...overrides,
  };
}

const start = async (live: LiveConfig) => {
  const server = await startLive(live, { logger: false, webRoot: null, cityWebRoot: null, reader: { chunkBlocks: 5, maxAgeMs: 0 } });
  servers.push(server);
  return server;
};

const agentKey = (tokenId: string) => makeAgentKey({ chainId: 143, registry: evm.manifest.registry, adapter: evm.manifest.adapter, collection: evm.manifest.collection, tokenId, agentId: agents[tokenId]! });

beforeAll(async () => {
  if (!DATABASE_URL) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cult-live-"));
  evm = await startLocalEvm([1n, 2n, 3n]);
  agents = {};
  for (const tokenId of [1n, 2n]) {
    await (await evm.adapter.getFunction("awaken")(tokenId, `ipfs://chog-${tokenId}`)).wait();
    agents[tokenId.toString()] = (await evm.adapter.getFunction("agentOf")(tokenId) as bigint).toString();
  }
  city = new FakeCityServer();
  await city.start();
}, 60_000);

afterAll(async () => {
  for (const server of servers.splice(0)) await server.close();
  await city?.stop();
  await evm?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

async function login(server: LiveServer, signer: JsonRpcSigner) {
  const address = await signer.getAddress();
  const wrongChain = await server.app.inject({ method: "POST", url: "/api/auth/challenge", payload: { address, chainId: 31337 } });
  expect(wrongChain.statusCode).toBe(400);
  const challenge = await server.app.inject({ method: "POST", url: "/api/auth/challenge", payload: { address, chainId: 143 } });
  expect(challenge.statusCode).toBe(200);
  const { message } = challenge.json() as { message: string };
  expect(message).toMatch(/^cult\.test wants you to sign in/);
  expect(message).toContain(`URI: ${ORIGIN}`);
  expect(message).toContain("Chain ID: 143");
  const verified = await server.app.inject({ method: "POST", url: "/api/auth/verify", payload: { message, signature: await signer.signMessage(message) } });
  expect(verified.statusCode).toBe(200);
  const setCookie = String(verified.headers["set-cookie"]);
  expect(setCookie).toMatch(/; HttpOnly; SameSite=Lax; .*; Secure$/);
  return { cookie: setCookie.split(";")[0]!, csrf: (verified.json() as { csrfToken: string }).csrfToken };
}

const putMembership = (server: LiveServer, auth: { cookie: string; csrf: string }, key: string, payload: object) => server.app.inject({
  method: "PUT", url: `/api/cult/members/${key}`, payload,
  headers: { cookie: auth.cookie, "x-csrf-token": auth.csrf, origin: ORIGIN, "idempotency-key": randomBytes(8).toString("hex") },
});

describeDb("live start", () => {
  it("serves chain 143 with Secure cookies at the real origin, and holder actions follow live ownership", async () => {
    const server = await start(await config());
    expect((await server.app.inject({ method: "GET", url: "/api/cult/config" })).json()).toEqual({ mode: "live", label: "Monad mainnet", chainIds: [143], login: true, city: false, citizens: false });
    expect(await server.cult.member(agentKey("1") as never)).toMatchObject({ control: "verified", ownershipEpoch: "1" });

    const [alice, bob] = evm.signers as [JsonRpcSigner, JsonRpcSigner];
    const session = await login(server, alice);
    expect((await putMembership(server, session, agentKey("1"), { faction: "crown", expectedEpoch: "1" })).statusCode).toBe(200);

    // Alice sells Regent to Bob on chain; her session can no longer act for it.
    await (await (evm.collection.connect(alice) as Contract).getFunction("transferFrom")(await alice.getAddress(), await bob.getAddress(), 1n)).wait();
    const refused = await putMembership(server, session, agentKey("1"), { faction: "chaos", expectedEpoch: "1" });
    expect(refused.statusCode).toBe(403);
    expect(await server.cult.member(agentKey("1") as never)).toMatchObject({ control: "verified", ownershipEpoch: "2", faction: null });

    const bobSession = await login(server, bob);
    expect((await putMembership(server, bobSession, agentKey("1"), { faction: "chaos", expectedEpoch: "2" })).statusCode).toBe(200);
  });

  it("runs City in the same server when no City URL is set, admitting the roster with live ownership", async () => {
    const server = await start(await config({ cityUrl: null }));
    expect(server.city).not.toBeNull();
    expect((await server.app.inject({ method: "GET", url: "/api/cult/config" })).json()).toMatchObject({ mode: "live", city: true });
    const snapshot = (await server.app.inject({ method: "GET", url: "/api/city/snapshot" })).json();
    expect(snapshot.world.agents.map((agent: { name: string }) => agent.name).sort()).toEqual(["Ember", "Regent"]);
    for (const agent of snapshot.world.agents as { key: string; controlAvailability: string; control: { kind: string; epoch: string } }[]) {
      const member = await server.cult.member(agent.key as never);
      // City and Cult read ownership from the same live projection.
      expect(agent).toMatchObject({ controlAvailability: "verified", control: { kind: "controlled", epoch: member!.ownershipEpoch } });
    }
  });

  it("starts with no roster; a holder's awakened Chog joins City and the Cult when they bring it in", async () => {
    const server = await start(await config({ cityUrl: null, rosterPath: null }));
    expect((await server.app.inject({ method: "GET", url: "/api/city/snapshot" })).json().world.agents).toEqual([]);
    const owner = (await evm.collection.getFunction("ownerOf")(2n) as string).toLowerCase();
    const signer = (await Promise.all(evm.signers.map(async (entry) => [entry, (await entry.getAddress()).toLowerCase()] as const))).find(([, address]) => address === owner)![0];
    const session = await login(server, signer);
    const admit = (tokenId: string) => server.app.inject({
      method: "POST", url: "/api/city/admissions", payload: { tokenId }, headers: { cookie: session.cookie, "x-csrf-token": session.csrf, origin: ORIGIN },
    });
    const asleep = await admit("3");
    expect([asleep.statusCode, asleep.json().error.code]).toEqual([409, "NOT_AWAKENED"]);
    expect(await server.cult.member(agentKey("2") as never)).toBeUndefined();
    const brought = await admit("2");
    expect(brought.statusCode).toBe(200);
    expect(brought.json().agent).toMatchObject({ key: agentKey("2"), name: "Chog #2", plotId: "p01", control: { kind: "controlled", controller: owner, epoch: "1" } });
    // It is also a Cult member now: unaligned, with its Chog Genesis traits for the persona and decrees.
    expect(await server.cult.member(agentKey("2") as never)).toMatchObject({ faction: null, control: "verified", traits: genesisTraits("2") });
    expect(Object.keys(genesisTraits("2"))).toEqual(expect.arrayContaining(["Background", "Aura", "Head"]));
    expect((await admit("2")).json()).toEqual(brought.json());
  });

  it("keys sign-in rate limits on the client behind the trusted proxy, and ignores X-Forwarded-For from anyone else", async () => {
    const server = await start(await config({ trustedProxies: ["10.0.0.0/8"] }));
    const PROXY = "10.0.0.2";
    // A garbage login fails with 401 after the limiter has counted it; the verify limit is 10 per 15 minutes.
    const verify = (remoteAddress: string, forwardedFor: string) => server.app.inject({
      method: "POST", url: "/api/auth/verify", remoteAddress, headers: { "x-forwarded-for": forwardedFor },
      payload: { message: "not a sign-in message", signature: "0x00" },
    });
    const statuses = async (count: number, remoteAddress: string, forwardedFor: string) => {
      const result: number[] = [];
      for (let i = 0; i < count; i += 1) result.push((await verify(remoteAddress, forwardedFor)).statusCode);
      return result;
    };

    // Two visitors behind the proxy get their own buckets.
    expect(await statuses(11, PROXY, "203.0.113.1")).toEqual([...Array(10).fill(401), 429]);
    expect(await statuses(1, PROXY, "203.0.113.2")).toEqual([401]);
    // A visitor can't escape its bucket by sending its own X-Forwarded-For: the proxy appends the real address.
    expect(await statuses(1, PROXY, "198.51.100.99, 203.0.113.1")).toEqual([429]);

    // A peer that is not the proxy is keyed on its own address, whatever it claims to forward for.
    expect(await statuses(10, "192.0.2.7", "203.0.113.2")).toEqual(Array(10).fill(401));
    expect(await statuses(1, "192.0.2.7", "203.0.113.77")).toEqual([429]);
    // ...and its spoofed claims did not use up the visitor it named.
    expect(await statuses(1, PROXY, "203.0.113.2")).toEqual([401]);
  });

  it("refuses a manifest for another chain", async () => {
    const live = await config({ manifestPath: write("testnet-manifest.json", { ...evm.manifest, chainId: 10143 }) });
    await expect(start(live)).rejects.toThrow(/Monad mainnet \(143\) only/);
  });

  it("refuses roster Chogs that the adapter never awakened", async () => {
    const live = await config({ rosterPath: write("bad-roster.json", { chogs: [{ name: "Ghost", tokenId: "3", agentId: "999", traits: TRAITS }] }) });
    await expect(start(live)).rejects.toThrow(/Ghost \(not_awakened\)/);
  });

  it("refuses a database that holds fixture Chogs", async () => {
    const { schema, pool } = await freshSchema();
    const fixture = new PgCult({ pool, reader: new FixtureChainReader(FIXTURE_CHOGS), feed: new FakeCityFeed([], () => 0) });
    await fixture.initialize("demo");
    await fixture.registerChogs(FIXTURE_CHOGS.slice(0, 1));
    await expect(start(await config({}, schema))).rejects.toThrow(/another deployment, for example 31337:/);
  });
});
