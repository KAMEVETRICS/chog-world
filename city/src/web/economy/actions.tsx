// Shared plumbing for economy actions in the UI: refusal messages, a busy/status hook, and the gift form.
import { useState } from 'react';
import type { AccountAsset, ActionRefusal, ActionResult, CityAction, Party, WorldState } from '../../shared/contracts';

export type OnAct = (action: CityAction, idempotencyKey: string) => Promise<ActionResult>;

export const ACTION_ERRORS: Record<ActionRefusal, string> = {
  LOGIN_REQUIRED: 'Sign in first.',
  NOT_A_CITIZEN: 'Join the city first.',
  NOT_CONTROLLER: "Only this Chog's current holder can do that.",
  CONTROL_CHANGED: 'This Chog changed hands. Reload and try again.',
  NOT_FOUND: 'That resident is no longer in the village.',
  IDEMPOTENCY_CONFLICT: 'That request collided with an earlier one. Please try again.',
  NOT_ENOUGH: 'Not enough to pay for that.',
  NO_ROOM: 'No room in the stores for that.',
  TREASURY_EMPTY: "The treasury can't pay for that right now.",
  MARKET_EMPTY: "The market doesn't have that much in stock.",
  NO_OFFER: 'That job offer was withdrawn.',
  OFFER_TAKEN: 'Someone else already took that job.',
  NOT_NEEDED: 'The project needs no more of that.',
  NOT_ALLOWED: "That isn't allowed.",
  CANT_VOTE_YET: 'Villagers can vote after working on 3 different village days.',
  VOTE_CLOSED: 'That vote has closed.',
  TOO_MANY_PROPOSALS: 'Too many proposals are open. Each Chog may have one open at a time, and the city five.',
};

export const ASSET_LABEL: Record<AccountAsset, string> = { coins: 'Coins', wood: 'Wood', stone: 'Stone', food: 'Food' };

/** "1 coin", "5 coins", "3 wood". */
export const amountOf = (amount: number, asset: AccountAsset) => (asset === 'coins' ? `${amount} ${amount === 1 ? 'coin' : 'coins'}` : `${amount} ${asset}`);

/** Runs one action at a time and remembers how it went, for a status line. */
export function useAct(onAct: OnAct) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const run = async (action: CityAction, success: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await onAct(action, crypto.randomUUID());
      setStatus(result.ok ? { tone: 'ok', text: success } : { tone: 'error', text: ACTION_ERRORS[result.code] });
      return result.ok;
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'That did not go through.' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, status, run };
}

export function ActionStatus({ status }: { status: { tone: 'ok' | 'error'; text: string } | null }) {
  return (
    <p className={`settings-status decor-status${status?.tone === 'error' ? ' decor-status--error' : ''}`} role="status" aria-live="polite">
      {status?.text ?? ''}
    </p>
  );
}

/** A whole number from 1 up, or null while the field is empty or invalid. */
export function parseAmount(text: string): number | null {
  return /^[1-9][0-9]{0,3}$/.test(text.trim()) ? Number(text.trim()) : null;
}

export function AmountInput({ value, max, onChange }: { value: string; max: number; onChange: (text: string) => void }) {
  return <input className="text-input" type="number" inputMode="numeric" min={1} max={max} value={value} aria-invalid={value !== '' && parseAmount(value) === null} onChange={(e) => onChange(e.target.value)} />;
}

/** Everyone a gift can go to, except the giver. */
export function recipients(world: WorldState, except: string): Array<{ key: string; label: string; citizen: boolean }> {
  return [
    ...world.agents.filter((a) => a.control.kind === 'controlled' && a.key !== except).map((a) => ({ key: a.key, label: `${a.name} (Chog)`, citizen: false })),
    ...world.citizens.filter((c) => c.key !== except).map((c) => ({ key: c.key, label: `${c.name} (villager)`, citizen: true })),
  ];
}

/** Give coins (or, from a Chog to a Chog, materials). */
export function GiftForm({ world, from, fromKey, canGiveMaterials, onAct }: { world: WorldState; from: Party; fromKey: string; canGiveMaterials: boolean; onAct: OnAct }) {
  const options = recipients(world, fromKey);
  const [to, setTo] = useState(options[0]?.key ?? '');
  const [asset, setAsset] = useState<AccountAsset>('coins');
  const [amountText, setAmountText] = useState('1');
  const amount = parseAmount(amountText);
  const { busy, status, run } = useAct(onAct);
  const toCitizen = options.find((o) => o.key === to)?.citizen ?? true;
  const assets: AccountAsset[] = canGiveMaterials && !toCitizen ? ['coins', 'wood', 'stone', 'food'] : ['coins'];
  const chosen = assets.includes(asset) ? asset : 'coins';
  const name = options.find((o) => o.key === to)?.label.replace(/ \(.*\)$/, '') ?? '';
  return (
    <form
      className="econ-form"
      aria-label="Give a gift"
      onSubmit={(e) => {
        e.preventDefault();
        if (amount === null) return;
        void run({ type: 'gift', from, to, asset: chosen, amount }, `Gave ${name} ${amountOf(amount, chosen)}.`);
      }}
    >
      <label className="look-pick">
        <span className="setting-label">To</span>
        <select className="select-input" value={to} onChange={(e) => setTo(e.target.value)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="look-pick">
        <span className="setting-label">What</span>
        <select className="select-input" value={chosen} onChange={(e) => setAsset(e.target.value as AccountAsset)}>
          {assets.map((a) => (
            <option key={a} value={a}>
              {ASSET_LABEL[a]}
            </option>
          ))}
        </select>
      </label>
      <label className="look-pick econ-amount">
        <span className="setting-label">Amount</span>
        <AmountInput value={amountText} max={chosen === 'coins' ? 500 : 10} onChange={setAmountText} />
      </label>
      <button type="submit" className="button button--quiet button--small" disabled={busy || !to || amount === null}>
        Give
      </button>
      <ActionStatus status={status} />
    </form>
  );
}
