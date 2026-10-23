// A Chog's look, from its NFT metadata. Presentation only: never read by the simulation.
// Trait names and values follow the Chog Genesis metadata (Skin, Head, Body, Eyes, ...).

export interface ChogTraits {
  Background?: string;
  Aura?: string;
  Base?: string;
  Skin?: string;
  Body?: string;
  Mouth?: string;
  Eyes?: string;
  Head?: string;
  Accessory?: string;
  Form?: string;
}

export interface ChogLook {
  /** The NFT this look comes from (in fixture mode, a real Chog Genesis token lent to a test resident). */
  sourceTokenId: string;
  image: string | null;
  traits: ChogTraits;
}

export type SkinPalette = { fur: string; furDeep: string; mask: string; mitt: string };

export type HatKind =
  | 'none' | 'cap' | 'bucket' | 'beanie' | 'crown' | 'wizard' | 'ushanka' | 'helmet' | 'fedora'
  | 'horns' | 'band' | 'hair' | 'halo' | 'laurel' | 'thirdEye' | 'diamond' | 'shroom' | 'banana';
export type OutfitKind = 'none' | 'tee' | 'suit' | 'hoodie' | 'robe' | 'vest' | 'jacket' | 'armor' | 'jumpsuit' | 'duck';
export type EyeKind =
  | 'round' | 'happy' | 'lidded' | 'crying' | 'laser' | 'glasses' | 'btc' | 'visor' | 'vr' | 'dead' | 'heart' | 'thug';
export type MouthKind = 'smile' | 'sad' | 'flat' | 'open' | 'clown' | 'drool' | 'gum' | 'coin' | 'goldTooth' | 'puke';
export type HeldKind = 'none' | 'frog' | 'coin' | 'cigar' | 'candleGreen' | 'candleRed' | 'heart' | 'knife';

export interface Appearance {
  skin: SkinPalette;
  skull: boolean;
  radioactive: boolean;
  hat: { kind: HatKind; color: string; accent: string };
  outfit: { kind: OutfitKind; color: string; accent: string; stripes: boolean };
  eyes: { kind: EyeKind; color: string };
  mouth: MouthKind;
  held: HeldKind;
  aura: string | null;
  background: string;
}

const SKINS: Record<string, SkinPalette> = {
  Origin: { fur: '#5b36b0', furDeep: '#41228f', mask: '#fbf3cd', mitt: '#d4407c' },
  Pink: { fur: '#ee8db6', furDeep: '#cf6690', mask: '#fbf1e6', mitt: '#d4407c' },
  Red: { fur: '#d8423a', furDeep: '#a92d27', mask: '#fbf0e4', mitt: '#d4407c' },
  Black: { fur: '#2c2731', furDeep: '#18151c', mask: '#6b3e27', mitt: '#d4407c' },
  Yellow: { fur: '#f0c22e', furDeep: '#c79a12', mask: '#fbf3cd', mitt: '#d4407c' },
  Blue: { fur: '#3fb5de', furDeep: '#2582a6', mask: '#8fe2f0', mitt: '#2a8fb8' },
  White: { fur: '#f1eee8', furDeep: '#cfc7ba', mask: '#fbf3cd', mitt: '#d4407c' },
  Green: { fur: '#4fae5a', furDeep: '#357f3e', mask: '#eaf6dc', mitt: '#d4407c' },
  Jade: { fur: '#3fa58c', furDeep: '#2a7a66', mask: '#dcf3ea', mitt: '#d4407c' },
  Purple: { fur: '#8f45d6', furDeep: '#6a2aa8', mask: '#fbf3cd', mitt: '#d4407c' },
  'Multi Colored': { fur: '#f08a3c', furDeep: '#7b5ce0', mask: '#fbf3cd', mitt: '#3fb5de' },
  Beige: { fur: '#d8c29a', furDeep: '#b29b6f', mask: '#fbf3cd', mitt: '#d4407c' },
  Grey: { fur: '#8d8a94', furDeep: '#6a6771', mask: '#ece8e0', mitt: '#d4407c' },
  Metal: { fur: '#a9b1b9', furDeep: '#7c848c', mask: '#dfe4e8', mitt: '#6c757d' },
};

/** Colour words that appear in trait names, checked in order. */
const COLOR_WORDS: [RegExp, string][] = [
  [/\bblack|dark|thug|mafia|gangster|robber\b/i, '#2b2733'],
  [/\bwhite|pure|cream\b/i, '#f4f1ea'],
  [/\bred|fire|devil|demon\b/i, '#d9473b'],
  [/\bcyan|aqua|sky\b/i, '#45c4dc'],
  [/\bblue\b/i, '#3b6fd0'],
  [/\bgreen|toad green|army|poison\b/i, '#4c9a52'],
  [/\byellow|banana|gold|golden\b/i, '#efc236'],
  [/\bpink|peach|boob|rose\b/i, '#f08fb1'],
  [/\bpurple|void|violet|mon\b/i, '#7b4fd8'],
  [/\borange|btc\b/i, '#f08a2c'],
  [/\bgr[ae]y|silver|metal\b/i, '#9aa3ab'],
  [/\bbrown|farmer|homeless\b/i, '#9a6a44'],
];

function colorFrom(name: string, fallback: string): string {
  for (const [re, color] of COLOR_WORDS) if (re.test(name)) return color;
  return fallback;
}

/** Stable pick from a palette for names with no colour word. */
function hashColor(name: string, palette: string[]): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}

const CAP_PALETTE = ['#f4f1ea', '#7b4fd8', '#3b6fd0', '#d9473b', '#2b2733', '#4c9a52', '#f08a2c'];

function hat(name: string | undefined): Appearance['hat'] {
  if (!name) return { kind: 'none', color: '', accent: '' };
  const n = name.toLowerCase();
  const c = (fallback: string) => colorFrom(name, fallback);
  if (n.includes('bucket') || n === 'thunder cap') return { kind: 'bucket', color: c('#3b8fd8'), accent: '#f2c230' };
  if (n.includes('beanie')) return { kind: 'beanie', color: c(hashColor(name, CAP_PALETTE)), accent: '#f4f1ea' };
  if (n === 'mon cap') return { kind: 'cap', color: '#f4f1ea', accent: '#7b4fd8' };
  if (n.includes('mcga') || n.includes('mmga') || n.includes('mega')) return { kind: 'cap', color: '#7b4fd8', accent: '#5a35b0' };
  if (n === 'plumber') return { kind: 'cap', color: '#d9473b', accent: '#b23328' };
  if (n.includes('cap') || n === 'neet' || n.includes('peace')) {
    const color = c(hashColor(name, CAP_PALETTE));
    return { kind: 'cap', color, accent: color === '#f4f1ea' ? '#7b4fd8' : '#2b2733' };
  }
  if (n === 'crown') return { kind: 'crown', color: '#f2c230', accent: '#d9473b' };
  if (n.includes('wizard')) return { kind: 'wizard', color: '#2a3f8f', accent: '#f2c230' };
  if (n.includes('russian')) return { kind: 'ushanka', color: '#d8c29a', accent: '#a98f63' };
  if (n.includes('spartan')) return { kind: 'helmet', color: '#c9973b', accent: '#d9473b' };
  if (n.includes('mafia')) return { kind: 'fedora', color: '#2b2733', accent: '#d9473b' };
  if (n.includes('thorn') || n.includes('wreath')) return { kind: 'laurel', color: c('#f2c230'), accent: '#4c9a52' };
  if (n === 'robber') return { kind: 'band', color: '#2b2733', accent: '#2b2733' };
  if (n.includes('horn')) return { kind: 'horns', color: c('#d9473b'), accent: '#2b2733' };
  if (n.includes('headband') || n.includes('bandana') || n.includes('wrap') || n.includes('durag'))
    return { kind: 'band', color: c(n.includes('japan') ? '#f4f1ea' : '#2b2733'), accent: '#d9473b' };
  if (n.includes('hair') || n.includes('wig')) return { kind: 'hair', color: n.includes('rainbow') ? 'rainbow' : '#2b2733', accent: '#f2c230' };
  if (n.includes('holy') || n.includes('halo')) return { kind: 'halo', color: '#f2d36b', accent: '#fff6c9' };
  if (n.includes('3rd eye')) return { kind: 'thirdEye', color: '#f4f1ea', accent: '#2b2733' };
  if (n.includes('blue laser')) return { kind: 'thirdEye', color: '#45c4dc', accent: '#45c4dc' };
  if (n === 'diamond') return { kind: 'diamond', color: '#9fe6f5', accent: '#ffffff' };
  if (n.includes('shroom')) return { kind: 'shroom', color: '#7b4fd8', accent: '#f4f1ea' };
  if (n.includes('banana')) return { kind: 'banana', color: '#f2d040', accent: '#c9c2b4' };
  if (n.includes('clown')) return { kind: 'none', color: '', accent: '' }; // nose is drawn with the mouth
  return { kind: 'cap', color: hashColor(name, CAP_PALETTE), accent: '#2b2733' };
}

function outfit(name: string | undefined): Appearance['outfit'] {
  if (!name) return { kind: 'none', color: '', accent: '', stripes: false };
  const n = name.toLowerCase();
  const stripes = /stripe|prisoner|inmate|trackset/.test(n);
  const c = (fallback: string) => colorFrom(name, fallback);
  if (n.includes('duck')) return { kind: 'duck', color: '#f2c230', accent: '#f08a2c', stripes: false };
  if (/armor|sci fi|astro/.test(n)) return { kind: 'armor', color: c('#c9cfd6'), accent: '#f2c230', stripes: false };
  if (n.includes('tuxedo') || n.includes('suit') || n.includes('mafia') || n === 'gojo')
    return { kind: 'suit', color: c('#2b2733'), accent: '#d9473b', stripes: false };
  if (n.includes('hoodie')) return { kind: 'hoodie', color: c(hashColor(name, CAP_PALETTE)), accent: '#f4f1ea', stripes: false };
  if (/robe|yukata|jesus|wizard|chinese|cape|kings/.test(n))
    return { kind: 'robe', color: c(n.includes('kings') ? '#a8323a' : '#f4f1ea'), accent: '#f2c230', stripes: false };
  if (n.includes('vest')) return { kind: 'vest', color: c('#4c9a52'), accent: '#f4f1ea', stripes: false };
  if (n.includes('jacket') || n.includes('trackset')) return { kind: 'jacket', color: c('#3b6fd0'), accent: '#f4f1ea', stripes };
  if (/squid|prisoner|inmate|mummy/.test(n))
    return { kind: 'jumpsuit', color: n.includes('guard') ? '#e2557f' : n.includes('squid') ? '#2f8f6e' : n.includes('mummy') ? '#efe6cf' : '#f08a2c', accent: '#2b2733', stripes };
  return { kind: 'tee', color: c(hashColor(name, ['#f4f1ea', '#f2c230', '#45c4dc', '#f08fb1', '#4c9a52', '#d9473b'])), accent: '#2b2733', stripes };
}

function eyes(name: string | undefined): Appearance['eyes'] {
  const n = (name ?? '').toLowerCase();
  const tint = /green/.test(n) ? '#2f8f4a' : /blue/.test(n) ? '#2a5fb8' : /red/.test(n) ? '#b8322a' : '#120c1c';
  if (n.includes('laser')) return { kind: 'laser', color: n.includes('fire') ? '#ff7a2c' : n.includes('green') ? '#4bff6a' : n.includes('cyan') ? '#4be7ff' : '#c04bff' };
  if (n.includes('btc')) return { kind: 'btc', color: '#f39a1e' };
  if (n.includes('visor') || n.includes('viper')) return { kind: 'visor', color: n.includes('sunset') ? '#ff8a5c' : n.includes('plasma') ? '#7be0ff' : '#c58bff' };
  if (n.includes('vr')) return { kind: 'vr', color: n.includes('modern') ? '#f4f1ea' : '#2b2733' };
  if (n.includes('thug')) return { kind: 'thug', color: '#120c1c' };
  if (n.includes('glass') || n === 'mog') return { kind: 'glasses', color: n.includes('anime') ? '#e9f7f5' : n.includes('3d') ? '#d9473b' : '#2b2733' };
  if (n.includes('cry') || n.includes('tear')) return { kind: 'crying', color: tint };
  if (n.includes('happy') || n === 'xd') return { kind: 'happy', color: tint };
  if (/flat|tired|smirk|side eye|retard/.test(n)) return { kind: 'lidded', color: tint };
  if (n === 'dead') return { kind: 'dead', color: '#120c1c' };
  if (n === 'heart') return { kind: 'heart', color: '#e0334f' };
  return { kind: 'round', color: tint };
}

function mouth(name: string | undefined): MouthKind {
  const n = (name ?? '').toLowerCase();
  if (n.includes('coin')) return 'coin';
  if (n.includes('bubblegum')) return 'gum';
  if (n.includes('puke')) return 'puke';
  if (n.includes('gold')) return 'goldTooth';
  if (n.includes('drool')) return 'drool';
  if (n.includes('clown')) return 'clown';
  if (n === 'sad' || n === 'worried') return 'sad';
  if (n === 'flat' || n === 'grit') return 'flat';
  if (n === 'wo' || n === 'lip bite') return 'open';
  return 'smile';
}

function held(accessory: string | undefined, head: string | undefined): HeldKind {
  const n = (accessory ?? '').toLowerCase();
  if (n === 'fwog' || n === 'pepe') return 'frog';
  if (n === 'coin' || n === 'sb') return 'coin';
  if (n === 'cigar') return 'cigar';
  if (n === 'green candle') return 'candleGreen';
  if (n === 'red candle') return 'candleRed';
  if (n === 'heart') return 'heart';
  if (n === 'knife') return 'knife';
  void head;
  return 'none';
}

function aura(name: string | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/burning|fiery|fire/.test(n)) return '#ff7a2c';
  if (n.includes('royal blue')) return '#3b6fd0';
  if (n.includes('royal')) return '#f2c230';
  if (n.includes('smoke')) return '#9aa3ab';
  if (/wind|clean/.test(n)) return '#f4f1ea';
  if (n.includes('mint')) return '#7be0b0';
  return colorFrom(name, '#c58bff');
}

const BACKGROUNDS: Record<string, string> = {
  'Light Purple': '#c9b6f2', Lemon: '#f6ec8f', Aqua: '#8fe0e0', Mon: '#836ef9', Sunlight: '#ffd27a', 'Lemon Yellow': '#f8e36a',
  Rosie: '#f6a6c1', 'Coral Pink': '#f59a9a', Mint: '#a7ecc8', 'Peach Pink': '#f9b9a7', 'Light Magenta': '#ef9ef0',
  'Soft Lavender': '#d9ccf5', 'Sky Blue': '#9fd6f4', 'Fresh Green': '#a6e39a', 'Deep Aqua': '#4fc3c9', Radioactive: '#9be36b',
};

export function appearanceOf(traits: ChogTraits): Appearance {
  const skull = traits.Base === 'Skull' || traits.Form === 'Skull';
  return {
    skin: SKINS[traits.Skin ?? 'Origin'] ?? SKINS.Origin!,
    skull,
    radioactive: traits.Base === 'Radioactive',
    hat: hat(traits.Head),
    outfit: outfit(traits.Body),
    eyes: eyes(traits.Eyes),
    mouth: traits.Head === 'Clown Nose' ? 'clown' : mouth(traits.Mouth),
    held: held(traits.Accessory, traits.Head),
    aura: aura(traits.Aura),
    background: BACKGROUNDS[traits.Background ?? ''] ?? colorFrom(traits.Background ?? '', '#d9ccf5'),
  };
}

/** The look of a Chog with no metadata: the classic purple Chog. */
export const DEFAULT_APPEARANCE: Appearance = appearanceOf({ Skin: 'Origin' });
