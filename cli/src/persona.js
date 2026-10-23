// Derived from Chog World cult/src/soul/persona.ts. Parity is checked by tests.
import { stableHash } from "./hash.js";
// Keywords come from Chog Genesis trait names (see the decree catalog in ../rules.ts).
const TEMPERAMENT = [
    ["aura", "fiery", "hot-headed"], ["aura", "burning", "hot-headed"], ["aura", "fire", "hot-headed"],
    ["aura", "royal", "regal"], ["aura", "yellow", "sunny"], ["background", "sunlight", "sunny"],
    ["aura", "aqua", "calm"], ["aura", "purple", "mysterious"], ["aura", "clean", "earnest"],
    ["eyes", "laser", "intense"], ["eyes", "crying", "melancholy"], ["eyes", "tear", "melancholy"], ["mouth", "sad", "melancholy"],
    ["eyes", "clown", "mischievous"], ["eyes", "dead", "deadpan"], ["eyes", "side", "suspicious"], ["eyes", "happy", "upbeat"],
    ["mouth", "bubblegum", "playful"], ["mouth", "drool", "dreamy"], ["mouth", "smile", "friendly"], ["mouth", "worried", "anxious"],
];
const TALENTS = [
    ["body", "tuxedo", "etiquette"], ["body", "robe", "ruling"], ["body", "armor", "defending the realm"],
    ["body", "hoodie", "street smarts"], ["body", "glitch", "hacking"], ["body", "astro", "exploring"],
    ["body", "farmer", "farming"], ["body", "hawaiian", "throwing parties"], ["body", "banana", "comedy"],
    ["body", "squid", "winning games"], ["body", "homeless", "surviving on nothing"], ["body", "dragon", "breathing fire"],
    ["head", "wizard", "spellcraft"], ["head", "crown", "giving orders"], ["head", "neet", "staying indoors"],
    ["head", "10k", "talking about Monad throughput"], ["head", "mon", "Monad lore"], ["head", "dollar", "making deals"],
    ["mouth", "gold", "spotting a bargain"], ["mouth", "btc", "trading"], ["eyes", "vr", "virtual worlds"], ["eyes", "retro", "old-school style"],
];
const VOICE = {
    "hot-headed": "short, loud sentences", regal: "grand, formal speech", sunny: "warm and encouraging", calm: "slow and soothing",
    mysterious: "cryptic hints", earnest: "plain and sincere", intense: "blunt and focused", melancholy: "wistful sighs",
    mischievous: "teasing jokes", deadpan: "dry one-liners", suspicious: "questions everything", upbeat: "bubbly exclamations",
    playful: "silly wordplay", dreamy: "drifting daydreams", friendly: "chatty and kind", anxious: "nervous rambling",
};
const CATCHPHRASES = {
    "hot-headed": ["Burn it down and build it better!", "No time, only fire."], regal: ["By decree of the crown!", "The Plaza deserves better."],
    sunny: ["Every tick is a good tick.", "Sun's out, Chogs out!"], calm: ["Breathe in, build slow.", "The river knows the way."],
    mysterious: ["Not everything is in the ledger...", "Ask the Workshop at midnight."], earnest: ["Honest work, honest home.", "One brick at a time."],
    intense: ["Eyes on the prize.", "Focus. Gather. Build."], melancholy: ["Even rain grows wheat.", "Some days the Tavern is quiet."],
    mischievous: ["Who moved my wood? Hehe.", "Rules are more like suggestions."], deadpan: ["Wow. A rock. Thrilling.", "I'm fine. Everything is fine."],
    suspicious: ["Who's really running the Crown?", "Trust no decree."], upbeat: ["Let's gooo!", "Best village ever!"],
    playful: ["Pop goes the gum!", "Tag, you're Chaos!"], dreamy: ["Imagine a tower of stone...", "Mmm, farm smells."],
    friendly: ["Hey neighbour!", "Come say hi at the Plaza!"], anxious: ["Is the food enough? Is it?", "What if the Tavern closes?"],
    curious: ["What's over there?", "Tell me everything."],
};
function matches(traits, rules) {
    const lower = Object.entries(traits).map(([type, value]) => [type.toLowerCase(), value.toLowerCase()]);
    const found = [];
    for (const [trait, keyword, value] of rules) {
        if (lower.some(([type, text]) => type === trait && text.includes(keyword)) && !found.includes(value))
            found.push(value);
    }
    return found;
}
/** "a", "a and b", "a, b and c". */
function list(items) {
    return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
export function personaFor(name, traits, agentKey) {
    const temperament = matches(traits, TEMPERAMENT).slice(0, 3);
    if (temperament.length === 0)
        temperament.push("curious");
    const talents = matches(traits, TALENTS).slice(0, 3);
    if (talents.length === 0)
        talents.push("making friends");
    const primary = temperament[0];
    const options = CATCHPHRASES[primary] ?? CATCHPHRASES.curious;
    const catchphrase = options[stableHash(`catchphrase|${agentKey}`) % options.length];
    const voice = VOICE[primary] ?? "curious questions";
    return {
        name, temperament, talents, voice, catchphrase,
        summary: `${name} is ${list(temperament)}, good at ${list(talents)}, and speaks in ${voice}.`,
    };
}
