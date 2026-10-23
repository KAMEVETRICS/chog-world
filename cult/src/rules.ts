// Every Chog Cult rule lives here, versioned. Changing a value changes RULES_VERSION.

export const RULES_VERSION = "cult-rules-1";

export const FACTIONS = ["crown", "chaos"] as const;
export type FactionId = (typeof FACTIONS)[number];

export const PLACES = ["plaza", "tavern", "workshop"] as const;
export type Place = (typeof PLACES)[number];

export const PHASES = ["propose", "debate", "vote", "resolve"] as const;
export type Phase = (typeof PHASES)[number];

export type Stance = "persona" | "abstain";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface Timing {
  readonly phaseMs: Readonly<Record<Phase, number>>;
}

export const TIMING: Readonly<Record<"production" | "demo", Timing>> = {
  production: { phaseMs: { propose: 1 * HOUR, debate: 8 * HOUR, vote: 14 * HOUR, resolve: 1 * HOUR } },
  demo: { phaseMs: { propose: 30_000, debate: 90_000, vote: 210_000, resolve: 30_000 } },
};

/** Cycles that must pass in full between faction changes: a change in cycle c allows the next in c + 3. */
export const SWITCH_COOLDOWN_CYCLES = 2;
export const VOTE_WEIGHT = 3;
export const PRESENCE_WEIGHT = 1;
/** Maximum City presence points one Chog can earn for its faction at one place in one cycle. */
export const PRESENCE_CAP_PER_AGENT = 5;
/** Overdue cycles the scheduler may resolve after downtime; the rest is recorded as a gap. */
export const MAX_CATCH_UP_CYCLES = 1;

/** Chog Genesis metadata trait types (from the collection's IPFS metadata), compared case-insensitively. */
export type TraitType = "background" | "aura" | "skin" | "body" | "mouth" | "eyes" | "head" | "tier";

/** A trait value containing `keyword` (case-insensitive) adds `weight` to a decree's score. */
export interface TraitAffinity {
  readonly trait: TraitType;
  readonly keyword: string;
  readonly weight: number;
}

export interface Decree {
  readonly id: string;
  readonly faction: FactionId;
  readonly place: Place;
  readonly title: string;
  readonly banner: string;
  readonly feedLine: string;
  readonly affinities: readonly TraitAffinity[];
}

const a = (trait: TraitType, keyword: string, weight: number): TraitAffinity => ({ trait, keyword, weight });

// Keywords come from sampled Chog Genesis trait names (for example "Kings Robe", "Fiery Aura", "Green laser").
// Catalog order is the stable order for display and for breaking tied vote counts.
export const DECREES: readonly Decree[] = [
  { id: "crown-parade", faction: "crown", place: "plaza", title: "Crown Parade", banner: "crown-gold", feedLine: "The Crown marches through the Plaza.", affinities: [a("head", "crown", 3), a("body", "robe", 2), a("aura", "royal", 2)] },
  { id: "golden-lanterns", faction: "crown", place: "plaza", title: "Golden Lanterns", banner: "lantern-gold", feedLine: "Golden lanterns light the Plaza.", affinities: [a("body", "golden", 2), a("mouth", "gold", 2), a("background", "sunlight", 1), a("aura", "yellow", 1)] },
  { id: "hour-of-silence", faction: "crown", place: "plaza", title: "Hour of Silence", banner: "silence-white", feedLine: "The Plaza keeps the Crown's hour of silence.", affinities: [a("body", "tuxedo", 2), a("mouth", "sad", 1), a("eyes", "flat", 1), a("mouth", "normal", 1)] },
  { id: "royal-toast", faction: "crown", place: "tavern", title: "Royal Toast", banner: "goblet-gold", feedLine: "The Tavern raises a toast to the Crown.", affinities: [a("body", "tuxedo", 2), a("aura", "royal", 2), a("head", "crown", 2)] },
  { id: "noble-supper", faction: "crown", place: "tavern", title: "Noble Supper", banner: "table-velvet", feedLine: "A noble supper is served at the Tavern.", affinities: [a("body", "robe", 2), a("mouth", "smile", 1), a("background", "peach", 1)] },
  { id: "quiet-ledger", faction: "crown", place: "tavern", title: "Quiet Ledger", banner: "ledger-green", feedLine: "The Crown keeps the Tavern's books.", affinities: [a("head", "dollar", 2), a("eyes", "btc", 2), a("mouth", "btc", 2)] },
  { id: "golden-forge", faction: "crown", place: "workshop", title: "Golden Forge", banner: "anvil-gold", feedLine: "The Workshop forges for the Crown.", affinities: [a("body", "armor", 3), a("body", "golden", 1), a("aura", "yellow", 1)] },
  { id: "royal-charter", faction: "crown", place: "workshop", title: "Royal Charter", banner: "scroll-blue", feedLine: "The Workshop works under royal charter.", affinities: [a("head", "wizard", 2), a("eyes", "retro", 1), a("body", "white", 1)] },
  { id: "guild-standard", faction: "crown", place: "workshop", title: "Guild Standard", banner: "guild-brown", feedLine: "The Crown's guild sets the Workshop standard.", affinities: [a("body", "farmer", 2), a("head", "cap", 1), a("eyes", "round", 1)] },
  { id: "graffiti-night", faction: "chaos", place: "plaza", title: "Graffiti Night", banner: "spray-neon", feedLine: "Chaos paints the Plaza overnight.", affinities: [a("body", "hoodie", 2), a("body", "glitch", 2), a("eyes", "laser", 1)] },
  { id: "mask-market", faction: "chaos", place: "plaza", title: "Mask Market", banner: "mask-purple", feedLine: "Masked traders fill the Plaza.", affinities: [a("eyes", "clown", 3), a("body", "squid", 2), a("eyes", "visor", 1)] },
  { id: "bell-riot", faction: "chaos", place: "plaza", title: "Bell Riot", banner: "bell-red", feedLine: "Every bell in the Plaza rings at once.", affinities: [a("aura", "fiery", 2), a("aura", "burning", 2), a("aura", "fire", 1), a("eyes", "fire", 1)] },
  { id: "bubblegum-brawl", faction: "chaos", place: "tavern", title: "Bubblegum Brawl", banner: "gum-pink", feedLine: "A bubblegum brawl breaks out in the Tavern.", affinities: [a("mouth", "bubblegum", 3), a("mouth", "drool", 1)] },
  { id: "open-tab", faction: "chaos", place: "tavern", title: "Open Tab", banner: "tab-orange", feedLine: "Chaos opens a tab nobody will pay.", affinities: [a("body", "hawaiian", 2), a("body", "banana", 2), a("mouth", "wo", 1)] },
  { id: "dead-mans-karaoke", faction: "chaos", place: "tavern", title: "Dead Man's Karaoke", banner: "mic-black", feedLine: "The Tavern hosts dead man's karaoke.", affinities: [a("eyes", "dead", 3), a("eyes", "crying", 1), a("eyes", "tear", 1)] },
  { id: "laser-tinkering", faction: "chaos", place: "workshop", title: "Laser Tinkering", banner: "laser-green", feedLine: "Lasers cut through the Workshop.", affinities: [a("eyes", "laser", 3), a("eyes", "vr", 1)] },
  { id: "scrap-rocket", faction: "chaos", place: "workshop", title: "Scrap Rocket", banner: "rocket-silver", feedLine: "Chaos builds a rocket from Workshop scrap.", affinities: [a("body", "astro", 3), a("head", "10k", 2), a("head", "mon", 1)] },
  { id: "sabotage-shift", faction: "chaos", place: "workshop", title: "Sabotage Shift", banner: "wrench-black", feedLine: "Chaos clocks in for a sabotage shift.", affinities: [a("body", "homeless", 2), a("head", "neet", 2), a("eyes", "side", 1)] },
];

export function decreesFor(faction: FactionId, place: Place): readonly Decree[] {
  return DECREES.filter((decree) => decree.faction === faction && decree.place === place);
}

export function decreeById(id: string): Decree | undefined {
  return DECREES.find((decree) => decree.id === id);
}

export const FACTION_INFO: Readonly<Record<FactionId, { readonly name: string; readonly creed: string }>> = {
  crown: { name: "The Crown", creed: "Order, wealth and influence." },
  chaos: { name: "The Chaos", creed: "Freedom, noise and disruption." },
};
