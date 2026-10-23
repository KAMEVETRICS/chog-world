// The three holder settings: Run/Pause, Focus, Home style. Nothing else is controllable.
import { useEffect, useRef, useState } from 'react';
import {
  FOCUSES,
  HOME_STYLES,
  type AgentState,
  type Focus,
  type HomeStyle,
  type PolicyUpdateRequest,
  type PolicyUpdateResult,
} from '../../shared/contracts';
import { CityApiError } from '../api/http-client';
import { FOCUS_HINT, FOCUS_LABEL, STYLE_LABEL } from '../format';
import { Home } from '../world/art';

interface Draft {
  active: boolean;
  focus: Focus;
  homeStyle: HomeStyle;
}

const draftOf = (agent: AgentState): Draft => ({
  active: agent.policy.active,
  focus: agent.policy.focus,
  homeStyle: agent.policy.homeStyle,
});
const sameDraft = (a: Draft, b: Draft) => a.active === b.active && a.focus === b.focus && a.homeStyle === b.homeStyle;

const ERRORS: Record<Exclude<PolicyUpdateResult, { ok: true }>['code'], string> = {
  POLICY_CHANGED: 'These settings changed somewhere else first. Review the latest version and save again.',
  CONTROL_CHANGED: 'This Chog changed hands. Its settings now belong to the new holder.',
  NOT_CONTROLLER: "Only this Chog's current holder can change its settings.",
  NOT_FOUND: 'This Chog is no longer in the village.',
  IDEMPOTENCY_CONFLICT: 'That save collided with an earlier one. Please try again.',
};

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

export function PolicySettings({
  agent,
  canEdit,
  onSave,
}: {
  agent: AgentState;
  canEdit: boolean;
  onSave: (request: PolicyUpdateRequest, idempotencyKey: string) => Promise<PolicyUpdateResult>;
}) {
  // `base` is the committed policy this form was loaded from; edits are measured against it,
  // so a newer policy committed elsewhere is never mistaken for the holder's own edit.
  const baseOf = (a: AgentState) => ({ version: a.policy.version, epoch: a.control.epoch, key: a.key, draft: draftOf(a) });
  const [draft, setDraft] = useState<Draft>(() => draftOf(agent));
  const [base, setBase] = useState(() => baseOf(agent));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const attemptKey = useRef<string | null>(null);

  const dirty = !sameDraft(draft, base.draft);
  const effective = !sameDraft(draft, draftOf(agent));
  const outdated = base.version !== agent.policy.version || base.epoch !== agent.control.epoch;

  // Switching residents, or a newer committed policy while the form is clean, refreshes silently.
  // While dirty, a newer version is surfaced instead of being overwritten.
  useEffect(() => {
    if (base.key !== agent.key || (outdated && !dirty)) {
      setDraft(draftOf(agent));
      setBase(baseOf(agent));
      setStatus((s) => (base.key !== agent.key ? { kind: 'idle' } : s));
    }
  }, [agent, base.key, outdated, dirty]);

  const update = (patch: Partial<Draft>) => {
    attemptKey.current = null;
    setStatus({ kind: 'idle' });
    setDraft((d) => ({ ...d, ...patch }));
  };

  const loadLatest = () => {
    attemptKey.current = null;
    setDraft(draftOf(agent));
    setBase(baseOf(agent));
    setStatus({ kind: 'idle' });
  };

  const save = async () => {
    attemptKey.current ??= crypto.randomUUID();
    setStatus({ kind: 'saving' });
    try {
      const result = await onSave({ expectedVersion: base.version, expectedEpoch: base.epoch, ...draft }, attemptKey.current);
      if (result.ok) {
        attemptKey.current = null;
        setBase(baseOf(result.agent));
        setDraft(draftOf(result.agent));
        setStatus({ kind: 'saved' });
      } else {
        setStatus({ kind: 'error', message: ERRORS[result.code] });
      }
    } catch (error) {
      // Keep the idempotency key: retrying the same save must not apply it twice.
      const refused = error instanceof CityApiError && error.status !== 0;
      setStatus({ kind: 'error', message: refused ? error.message : "Couldn't reach the village. Your change wasn't lost. Try saving again." });
    }
  };

  const disabled = !canEdit || agent.control.kind !== 'controlled';
  const c = agent.construction;

  return (
    <form
      className="settings"
      aria-label={`Settings for ${agent.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !disabled) void save();
      }}
    >
      <fieldset disabled={disabled} className="settings-fieldset">
        <div className="setting setting--run">
          <div>
            <span className="setting-label" id="run-label">
              {draft.active ? 'Running' : 'Paused'}
            </span>
            <span className="setting-hint">
              {draft.active ? 'Works on its own, even while you are away.' : 'Stays put and does nothing until resumed.'}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.active}
            aria-labelledby="run-label"
            className="switch"
            onClick={() => update({ active: !draft.active })}
          >
            <span className="switch-thumb" />
          </button>
        </div>

        <div className="setting" role="radiogroup" aria-labelledby="focus-label">
          <span className="setting-label" id="focus-label">
            Focus
          </span>
          <div className="choice-row">
            {FOCUSES.map((focus) => (
              <label key={focus} className={`choice${draft.focus === focus ? ' is-checked' : ''}`}>
                <input type="radio" name="focus" value={focus} checked={draft.focus === focus} onChange={() => update({ focus })} />
                <span className="choice-title">{FOCUS_LABEL[focus]}</span>
              </label>
            ))}
          </div>
          <span className="setting-hint">{FOCUS_HINT[draft.focus]}</span>
        </div>

        <div className="setting" role="radiogroup" aria-labelledby="style-label">
          <span className="setting-label" id="style-label">
            Home style
          </span>
          <div className="choice-row">
            {HOME_STYLES.map((style) => (
              <label key={style} className={`choice choice--style${draft.homeStyle === style ? ' is-checked' : ''}`}>
                <input type="radio" name="homeStyle" value={style} checked={draft.homeStyle === style} onChange={() => update({ homeStyle: style })} />
                <svg viewBox="-24 -36 48 54" width="40" height="45" aria-hidden="true">
                  <Home style={style} level={1} />
                </svg>
                <span className="choice-title">{STYLE_LABEL[style]}</span>
              </label>
            ))}
          </div>
          <span className="setting-hint">Applies to the next level this Chog builds.</span>
        </div>
      </fieldset>

      {canEdit && outdated && dirty ? (
        <div className="notice notice--warn" role="status">
          <p>These settings were changed elsewhere while you were editing.</p>
          <button type="button" className="link-button" onClick={loadLatest}>
            Load the latest
          </button>
        </div>
      ) : null}

      {canEdit && dirty && effective && c ? (
        <p className="notice notice--consequence">
          Saving cancels the level {c.targetLevel} build. {c.costs.wood} wood, {c.costs.stone} stone and {c.costs.food} food go
          back to its stores.
        </p>
      ) : null}

      {canEdit ? (
        <div className="settings-actions">
          <button type="submit" className="button button--primary" disabled={!dirty || status.kind === 'saving'}>
            {status.kind === 'saving' ? 'Saving…' : 'Save settings'}
          </button>
          {dirty ? (
            <button type="button" className="button button--quiet" onClick={loadLatest}>
              Discard
            </button>
          ) : null}
          <span className="settings-status" role="status" aria-live="polite">
            {status.kind === 'saved' && !dirty ? 'Saved' : null}
          </span>
        </div>
      ) : null}
      {status.kind === 'error' ? (
        <p className="notice notice--alert" role="alert">
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
