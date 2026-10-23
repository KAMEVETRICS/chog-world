// Chog Soul settings: the $CHOG token, the treasury that receives top-ups, the price list and caps.
// Amounts are $CHOG base units (18 decimals) as bigint. Design: docs/superpowers/specs/2026-10-20-chog-soul.md.

export const CHOG_TOKEN_MAINNET = "0x350035555e10d9afaf1566aaebfced5ba6c27777";
export const CHOG_DECIMALS = 18;
const UNIT = 10n ** BigInt(CHOG_DECIMALS);

export type SoulAction = "chat" | "debate" | "vote" | "council" | "bot";
/** Actions a Chog takes on its own; only these count toward the holder's daily cap. */
export const AUTOMATIC_ACTIONS: readonly SoulAction[] = ["debate", "vote", "council", "bot"];

export interface SoulPrices {
  readonly chat: bigint;
  readonly debate: bigint;
  readonly vote: bigint;
  /** One Chog City council session: speeches on open proposals and maybe a proposal. */
  readonly council: bigint;
  /** One Chog Bot reply (Discord, the web, other agents). */
  readonly bot: bigint;
}

export interface SoulConfig {
  readonly model: string;
  readonly prices: SoulPrices;
  /** Output-token cap per action: bounds what one action can cost the project. */
  readonly maxTokens: Readonly<Record<SoulAction, number>>;
  readonly defaultDailyCap: bigint;
  readonly maxDailyCap: bigint;
  readonly chatHistoryTurns: number;
}

export const DEFAULT_SOUL: SoulConfig = {
  model: "anthropic/claude-haiku-5.5",
  prices: { chat: UNIT, debate: UNIT / 4n, vote: UNIT / 4n, council: UNIT / 2n, bot: UNIT / 2n },
  maxTokens: { chat: 300, debate: 80, vote: 60, council: 450, bot: 400 },
  defaultDailyCap: 20n * UNIT,
  maxDailyCap: 1000n * UNIT,
  chatHistoryTurns: 12,
};

/** "1.25" CHOG → base units. Rejects more decimals than the token has. */
export function parseChog(text: string): bigint {
  const match = /^(0|[1-9][0-9]{0,24})(?:\.([0-9]{1,18}))?$/.exec(text.trim());
  if (!match) throw new Error(`"${text}" is not a CHOG amount like 1 or 0.25.`);
  return BigInt(match[1]!) * UNIT + BigInt((match[2] ?? "").padEnd(CHOG_DECIMALS, "0") || "0");
}

/** Base units → "1.25" (trailing zeros trimmed). */
export function formatChog(amount: bigint): string {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const whole = value / UNIT;
  const fraction = (value % UNIT).toString().padStart(CHOG_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
