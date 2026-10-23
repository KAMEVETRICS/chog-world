// The holder's side of the council: private standing instructions, and speaking for their Chog by hand.
import { useEffect, useState } from 'react';
import type { AgentState, InstructionsRequest, InstructionsResult, Stance, WorldState } from '../../shared/contracts';
import { MAX_INSTRUCTIONS, MAX_SPEECH } from '../../shared/rules';
import { isOpen } from '../../simulation/governance';
import { ActionStatus, useAct, type OnAct } from './actions';

const INSTRUCTION_ERRORS: Record<Exclude<InstructionsResult, { ok: true }>['code'], string> = {
  NOT_CONTROLLER: "Only this Chog's current holder can instruct it.",
  CONTROL_CHANGED: 'This Chog changed hands. Reload and try again.',
  NOT_FOUND: 'This Chog is no longer in the village.',
  LOGIN_REQUIRED: 'Sign in first.',
};

export function Instructions({
  agent,
  load,
  save,
}: {
  agent: AgentState;
  load: (key: string) => Promise<string | null>;
  save: (key: string, request: InstructionsRequest) => Promise<InstructionsResult>;
}) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void load(agent.key).then(
      (value) => {
        if (!live) return;
        setSaved(value ?? '');
        setText(value ?? '');
      },
      (error: unknown) => {
        if (!live) return;
        setStatus({ tone: 'error', text: error instanceof Error ? error.message : "Couldn't load instructions." });
      },
    );
    return () => {
      live = false;
    };
  }, [agent.key, agent.control.epoch, load]);

  return (
    <form
      className="econ-form"
      aria-label="Standing instructions"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setStatus(null);
        void save(agent.key, { expectedEpoch: agent.control.epoch, text })
          .then((result) => {
            if (result.ok) {
              setSaved(result.text);
              setStatus({ tone: 'ok', text: result.text ? `Saved. ${agent.name} will follow this at the next council.` : 'Cleared.' });
            } else setStatus({ tone: 'error', text: INSTRUCTION_ERRORS[result.code] });
          })
          .catch((error: unknown) => setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'That did not go through.' }))
          .finally(() => setBusy(false));
      }}
    >
      <label className="look-pick econ-wide">
        <span className="setting-label">What should {agent.name} push for?</span>
        <textarea
          className="text-input instructions-input"
          rows={3}
          maxLength={MAX_INSTRUCTIONS}
          placeholder="For example: lower the income tax, and help build the fountain."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="setting-hint econ-wide">
        Private to you. {agent.name} reads these at the morning council, speaks on open proposals and may put one forward. They are cleared if the Chog changes
        hands.
      </p>
      <button type="submit" className="button button--quiet button--small" disabled={busy || saved === null || text === saved}>
        Save instructions
      </button>
      <ActionStatus status={status} />
    </form>
  );
}

export function SpeakForm({ agent, world, onAct }: { agent: AgentState; world: WorldState; onAct: OnAct }) {
  const open = world.proposals.filter((p) => isOpen(p) && BigInt(world.tick) < BigInt(p.closesTick));
  const [proposalId, setProposalId] = useState(open[0]?.id ?? '');
  const [stance, setStance] = useState<Stance>('for');
  const [text, setText] = useState('');
  const { busy, status, run } = useAct(onAct);
  const chosen = open.some((p) => p.id === proposalId) ? proposalId : open[0]?.id ?? '';
  if (!open.length) return <p className="setting-hint">No open proposals to speak on.</p>;
  return (
    <form
      className="econ-form"
      aria-label="Speak at the council"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ type: 'speak', chog: agent.key, expectedEpoch: agent.control.epoch, proposalId: chosen, stance, text }, `${agent.name} spoke.`).then((ok) => ok && setText(''));
      }}
    >
      <label className="look-pick">
        <span className="setting-label">On</span>
        <select className="select-input" value={chosen} onChange={(e) => setProposalId(e.target.value)}>
          {open.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <label className="look-pick econ-amount">
        <span className="setting-label">Stance</span>
        <select className="select-input" value={stance} onChange={(e) => setStance(e.target.value as Stance)}>
          <option value="for">For</option>
          <option value="against">Against</option>
        </select>
      </label>
      <label className="look-pick econ-wide">
        <span className="setting-label">Speech</span>
        <input className="text-input" maxLength={MAX_SPEECH} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="submit" className="button button--quiet button--small" disabled={busy || !text.trim()}>
        Speak
      </button>
      <ActionStatus status={status} />
    </form>
  );
}
