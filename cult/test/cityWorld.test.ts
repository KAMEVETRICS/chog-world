import { describe, expect, it } from "vitest";
import { makeAgentKey, type AgentIdentity } from "../src/shared/identity.js";
import { CITY_PLACES, CITY_PLOTS, cityIdentity, cityObservation, cultIdentity, makeCityAgentKey } from "../src/citysim/world.js";
import { FIXTURE_CHOGS } from "../src/fixture/chogs.js";

const MAINNET: AgentIdentity = {
  chainId: 143, registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", adapter: "0x4A8d56DCAdB3bD4f8D9776E9e6F6211b845C6b02",
  collection: "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763", tokenId: "1969", agentId: "4133",
};
const evidence = { ownershipEpoch: "3", blockNumber: "115003561", blockHash: `0x${"ab".repeat(32)}`, observedAtMs: 1_000, projectionGeneration: "2" };

describe("City's code inside the Cult server", () => {
  it("builds the same agent key as Cult for every identity", () => {
    for (const identity of [MAINNET, ...FIXTURE_CHOGS.map((chog) => chog.identity)]) {
      expect(makeCityAgentKey(cityIdentity(identity))).toBe(makeAgentKey(identity));
      expect(cultIdentity(cityIdentity(identity))).toEqual({ ...identity, registry: identity.registry.toLowerCase(), adapter: identity.adapter.toLowerCase(), collection: identity.collection.toLowerCase() });
    }
    expect(() => cultIdentity({ ...cityIdentity(MAINNET), chainId: "1" })).toThrow("Unsupported chain 1");
  });

  it("maps ownership readings to City's terms without turning an outage into a change", () => {
    expect(cityObservation({ kind: "controlled", controller: "0xABCDEF0000000000000000000000000000000001", ...evidence }, 5)).toEqual({
      status: "controlled", controller: "0xabcdef0000000000000000000000000000000001", epoch: "3", projectionGeneration: "2",
      blockNumber: "115003561", blockHash: evidence.blockHash, observedAtMs: 1_000,
    });
    expect(cityObservation({ kind: "burned", ...evidence }, 5)).toMatchObject({ status: "burned", controller: null, epoch: "3" });
    expect(cityObservation({ kind: "not_awakened", ...evidence }, 5)).toMatchObject({ status: "unbound", controller: null });
    expect(cityObservation({ kind: "unavailable", reason: "indexer_lag" }, 5)).toEqual({ status: "unavailable", reason: "indexer_lag", observedAtMs: 5 });
  });

  it("uses City's village layout: 36 plots (12 on the main island, 24 in growth districts) and the three places Cult counts", () => {
    expect(new Set(CITY_PLOTS.map((plot) => plot.id)).size).toBe(36);
    // Admission takes the first free plot, so the main island fills before any district.
    expect(CITY_PLOTS.slice(0, 12).map((plot) => plot.id)).toEqual(Array.from({ length: 12 }, (_, i) => `p${String(i + 1).padStart(2, "0")}`));
    expect(CITY_PLACES.map((place) => place.id)).toEqual(expect.arrayContaining(["plaza", "tavern", "workshop", "forest", "quarry", "farm"]));
  });
});
