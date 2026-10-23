import { makeAgentKey, type AgentIdentity, type AgentKey } from "../shared/identity.js";
import type { Traits } from "../engine/types.js";

/** Local fixture only. Trait values use real Chog Genesis names; these are not real tokens or holders. */
export interface FixtureChog {
  readonly name: string;
  readonly identity: AgentIdentity;
  readonly agentKey: AgentKey;
  readonly traits: Traits;
  readonly owner: string;
}

export const FIXTURE_HOLDERS = {
  alice: "0x00000000000000000000000000000000000a11ce",
  bob: "0x0000000000000000000000000000000000000b0b",
  carol: "0x00000000000000000000000000000000000ca201",
  dave: "0x0000000000000000000000000000000000000da7",
  erin: "0x00000000000000000000000000000000000e2117",
  frank: "0x00000000000000000000000000000000000f2a2c",
  gina: "0x000000000000000000000000000000000000611a",
  hank: "0x0000000000000000000000000000000000004a2c",
} as const;
export type HolderName = keyof typeof FIXTURE_HOLDERS;

const FIXTURE_DEPLOYMENT = {
  chainId: 31337 as const,
  registry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
  adapter: "0x00000000000000000000000000000000000c4a77",
  collection: "0x00000000000000000000000000000000000c6091",
};

function chog(tokenId: number, name: string, owner: HolderName, traits: Traits): FixtureChog {
  const identity: AgentIdentity = { ...FIXTURE_DEPLOYMENT, tokenId: String(tokenId), agentId: String(tokenId + 100) };
  return { name, identity, agentKey: makeAgentKey(identity), traits, owner: FIXTURE_HOLDERS[owner] };
}

export const FIXTURE_CHOGS: readonly FixtureChog[] = [
  chog(1, "Regent", "alice", { Background: "Light Purple", Aura: "Royal Aura", Body: "Kings Robe", Mouth: "Smile", Eyes: "Retro Glass", Head: "Crown", Tier: "Uncommon" }),
  chog(2, "Banker", "bob", { Background: "Sunlight", Aura: "Yellow Aura", Body: "Golden Armor", Mouth: "Gold Tooth", Eyes: "BTC Glass", Head: "Dollar Cap", Tier: "Common" }),
  chog(3, "Butler", "carol", { Background: "Sky Blue", Aura: "Clean", Body: "Blue tuxedo", Mouth: "normal smile", Eyes: "Flat", Head: "Gray Bucket Cap", Tier: "Common" }),
  chog(4, "Ember", "dave", { Background: "Coral Pink", Aura: "Fiery Aura", Body: "Fire Shirt", Mouth: "Drooling", Eyes: "fire laser", Head: "RH Beanie", Tier: "Common" }),
  chog(5, "Glitch", "erin", { Background: "Deep Aqua", Aura: "Aqua Aura", Body: "Glitch Hoodie", Mouth: "Bubblegum", Eyes: "Green laser", Head: "NEET", Tier: "Uncommon" }),
  chog(6, "Jester", "frank", { Background: "Rosie", Aura: "Burning Aura", Body: "Squid Game Guard", Mouth: "Lip Bite", Eyes: "Clown Eye", Head: "Russian Hat", Tier: "Common" }),
  chog(7, "Drifter", "gina", { Background: "Mint", Aura: "Purple", Body: "Hawaiian Polo", Mouth: "Worried", Eyes: "Side Eye", Head: "Cloud Cap", Tier: "Common" }),
  chog(8, "Pilot", "hank", { Background: "Mon", Aura: "Light Purple", Body: "Astro Suit", Mouth: "Sad", Eyes: "Classic VR", Head: "10k TPS Cap", Tier: "Common" }),
];

export function chogByName(name: string): FixtureChog {
  const found = FIXTURE_CHOGS.find((entry) => entry.name === name);
  if (!found) throw new Error(`No fixture Chog named ${name}.`);
  return found;
}
