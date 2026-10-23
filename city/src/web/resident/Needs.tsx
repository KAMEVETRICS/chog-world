// Sims-style needs and mood, and the home's decorations (bought by the holder from the Chog's own stores).
import { useRef, useState } from 'react';
import { DECOR_IDS, NEED_IDS, RESOURCES, type AgentState, type DecorateRequest, type DecorateResult, type DecorId, type Need } from '../../shared/contracts';
import { DECOR, MAX_DECOR } from '../../shared/rules';
import { moodOf, type MoodKind } from '../../simulation/needs';
import { RESOURCE_LABEL } from '../format';
import { DecorArt, NeedIcon } from './sheet-art';

const NEED_LABEL: Record<Need, string> = { energy: 'Energy', hunger: 'Hunger', fun: 'Fun', social: 'Social' };

const MOOD_LABEL: Record<MoodKind, string> = {
  cheerful: 'Cheerful',
  content: 'Content',
  tired: 'Tired',
  hungry: 'Hungry',
  bored: 'Bored',
  lonely: 'Lonely',
  miserable: 'Miserable',
};

const MOOD_HINT: Record<MoodKind, string> = {
  cheerful: 'Rested, fed and happy at home.',
  content: 'Getting by fine.',
  tired: 'Will head home to rest soon.',
  hungry: 'Eats from its stores when it has food.',
  bored: 'Decorations make home more fun.',
  lonely: 'Will go find company soon.',
  miserable: 'Everything is running low.',
};

export function NeedsView({ agent }: { agent: AgentState }) {
  const mood = moodOf(agent);
  const tone = mood.kind === 'cheerful' || mood.kind === 'content' ? 'ok' : mood.kind === 'miserable' ? 'alert' : 'warn';
  return (
    <>
      <p className={`mood mood--${tone}`}>
        <span className="mood-name">{MOOD_LABEL[mood.kind]}</span>
        <span className="mood-hint">{MOOD_HINT[mood.kind]}</span>
      </p>
      <dl className="needs">
        {NEED_IDS.map((need) => {
          const value = agent.needs[need];
          return (
            <div key={need} className={`need need--${need}${value < 30 ? ' need--low' : ''}`}>
              <dt>
                <NeedIcon need={need} />
                {NEED_LABEL[need]}
              </dt>
              <dd>
                <span className="need-bar" role="img" aria-label={`${NEED_LABEL[need]} ${value} of 100`}>
                  <span style={{ width: `${value}%` }} />
                </span>
                <span className="need-figure num">{value}</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </>
  );
}

const DECOR_ERRORS: Record<Exclude<DecorateResult, { ok: true }>['code'], string> = {
  CONTROL_CHANGED: 'This Chog changed hands. Its home now belongs to the new holder.',
  NOT_CONTROLLER: "Only this Chog's current holder can decorate its home.",
  NOT_FOUND: 'This Chog is no longer in the village.',
  IDEMPOTENCY_CONFLICT: 'That purchase collided with an earlier one. Please try again.',
  ALREADY_OWNED: 'This home already has one.',
  DECOR_FULL: `A home holds at most ${MAX_DECOR} decorations.`,
  CANT_AFFORD: "Not enough free materials in this Chog's stores.",
};

const costText = (item: DecorId) =>
  RESOURCES.filter((r) => DECOR[item].costs[r] > 0)
    .map((r) => `${DECOR[item].costs[r]} ${RESOURCE_LABEL[r].toLowerCase()}`)
    .join(', ');

export function DecorShop({
  agent,
  canEdit,
  onDecorate,
}: {
  agent: AgentState;
  canEdit: boolean;
  onDecorate: (request: DecorateRequest, idempotencyKey: string) => Promise<DecorateResult>;
}) {
  const [busy, setBusy] = useState<DecorId | null>(null);
  const [message, setMessage] = useState<{ key: string; tone: 'ok' | 'error'; text: string } | null>(null);
  // Retrying the same purchase reuses its key, so a lost reply never buys twice.
  const attempt = useRef<{ item: DecorId; key: string } | null>(null);
  const shown = message?.key === agent.key ? message : null;
  const owned = agent.decor;

  const buy = async (item: DecorId) => {
    if (attempt.current?.item !== item) attempt.current = { item, key: crypto.randomUUID() };
    setBusy(item);
    setMessage(null);
    try {
      const result = await onDecorate({ expectedEpoch: agent.control.epoch, item }, attempt.current.key);
      attempt.current = null;
      setMessage(
        result.ok
          ? { key: agent.key, tone: 'ok', text: `${DECOR[item].name} added.` }
          : { key: agent.key, tone: 'error', text: DECOR_ERRORS[result.code] },
      );
    } catch (error) {
      setMessage({ key: agent.key, tone: 'error', text: error instanceof Error ? error.message : 'That did not go through.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="decor">
      {owned.length ? (
        <ul className="decor-grid" aria-label="Decorations">
          {owned.map((item) => (
            <li key={item} className="decor-card is-owned">
              <DecorArt item={item} />
              <span className="decor-name">{DECOR[item].name}</span>
              <span className="decor-placed">In the garden</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="readonly-note">No decorations yet.</p>
      )}
      {canEdit && owned.length < DECOR_IDS.length ? (
        <>
          <p className="decor-hint">
            Each one makes {agent.name} happier and adds fun while it rests at home. Paid from its free stores
            {owned.length >= MAX_DECOR ? '' : `, ${MAX_DECOR - owned.length} more ${MAX_DECOR - owned.length === 1 ? 'fits' : 'fit'}`}.
          </p>
          <ul className="decor-grid" aria-label="Decoration shop">
            {DECOR_IDS.filter((item) => !owned.includes(item)).map((item) => (
              <li key={item} className="decor-card">
                <DecorArt item={item} />
                <span className="decor-name">{DECOR[item].name}</span>
                <span className="decor-cost num">{costText(item)}</span>
                <button
                  type="button"
                  className="button button--quiet button--small decor-buy"
                  disabled={busy !== null || owned.length >= MAX_DECOR}
                  onClick={() => void buy(item)}
                  aria-label={`Buy ${DECOR[item].name} for ${costText(item)}`}
                >
                  {busy === item ? 'Buying…' : 'Buy'}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className={`settings-status decor-status${shown?.tone === 'error' ? ' decor-status--error' : ''}`} role="status" aria-live="polite">
        {shown?.text ?? ''}
      </p>
    </div>
  );
}
