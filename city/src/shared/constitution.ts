// The constitution: the only game numbers a vote or an office can change, and how far. Everything not
// listed here (ownership, the ledgers, the night rhythm, safety rules) is out of reach of any vote.
// Changing this file is a ruleset change: bump RULESET_VERSION in rules.ts.
import { PARAM_IDS, type ParamId, type Params } from './contracts';

export interface ParamRule {
  label: string;
  /** Shown after the number. */
  unit: string;
  /** What the number does, in one sentence. */
  meaning: string;
  default: number;
  min: number;
  max: number;
  /** The most one enacted change may move it, so no single vote can swing the economy. */
  maxStep: number;
}

export const CONSTITUTION: Readonly<Record<ParamId, ParamRule>> = {
  farmYield: { label: 'Farm yield', unit: 'food', meaning: 'Food from one tick of work at Clover Farm.', default: 3, min: 1, max: 6, maxStep: 1 },
  forestYield: { label: 'Forest yield', unit: 'wood', meaning: 'Wood from one tick of work at Whisperpine Forest.', default: 3, min: 1, max: 6, maxStep: 1 },
  quarryYield: { label: 'Quarry yield', unit: 'stone', meaning: 'Stone from one tick of work at Greystep Quarry.', default: 2, min: 1, max: 5, maxStep: 1 },
  wage: { label: 'Wage', unit: 'coins', meaning: 'New coins the city pays a citizen for one tick of work.', default: 5, min: 0, max: 10, maxStep: 2 },
  incomeTaxPct: { label: 'Income tax', unit: '%', meaning: 'Share of each wage that goes to the treasury.', default: 20, min: 0, max: 40, maxStep: 5 },
  marketFeePct: { label: 'Market fee', unit: '%', meaning: "The market's cut on every trade at the Plaza, kept by the treasury.", default: 10, min: 0, max: 30, maxStep: 5 },
};

/** What no vote can change, for the City Hall page. */
export const PROTECTED: readonly string[] = [
  'Who owns a Chog: that is read from the chain.',
  'The ledgers: every coin and every resource is recorded and must balance.',
  'Anything outside the table above, including night and day, the map and safety rules.',
];

export function defaultParams(): Params {
  return Object.fromEntries(PARAM_IDS.map((id) => [id, CONSTITUTION[id].default])) as Params;
}

export type ParamCheck = { ok: true; values: Params } | { ok: false; problems: string[] };

/** Checks a proposed change against the constitution. Unlisted keys are refused, not ignored. */
export function checkParamChange(current: Params, proposal: Readonly<Record<string, number>>): ParamCheck {
  const problems: string[] = [];
  const values = { ...current };
  const ids = Object.keys(proposal);
  if (ids.length === 0) problems.push('The proposal changes nothing.');
  for (const id of ids) {
    if (!(PARAM_IDS as readonly string[]).includes(id)) {
      problems.push(`"${id}" is not a number the constitution lets votes change.`);
      continue;
    }
    const rule = CONSTITUTION[id as ParamId];
    const next = proposal[id]!;
    const now = current[id as ParamId];
    if (!Number.isInteger(next)) problems.push(`${rule.label} must be a whole number.`);
    else if (next < rule.min || next > rule.max) problems.push(`${rule.label} must stay between ${rule.min} and ${rule.max}.`);
    else if (Math.abs(next - now) > rule.maxStep) problems.push(`${rule.label} can move by at most ${rule.maxStep} at a time.`);
    else if (next === now) problems.push(`${rule.label} is already ${now}.`);
    else values[id as ParamId] = next;
  }
  return problems.length ? { ok: false, problems } : { ok: true, values };
}
