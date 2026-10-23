// Shared projects: everyone sees progress; villagers give coins, holders give coins or materials from a Chog.
import { useState } from 'react';
import { PROJECT_IDS, type AccountAsset, type AgentState, type Party, type ProjectId, type WorldState } from '../../shared/contracts';
import { PROJECTS } from '../../shared/rules';
import { ActionStatus, AmountInput, amountOf, ASSET_LABEL, parseAmount, useAct, type OnAct } from './actions';

const ASSETS: AccountAsset[] = ['wood', 'stone', 'food', 'coins'];

function Contribute({ projectId, world, givers, onAct }: { projectId: ProjectId; world: WorldState; givers: Array<{ id: string; label: string; party: Party }>; onAct: OnAct }) {
  const needs = PROJECTS[projectId].needs;
  const given = world.projects[projectId].given;
  const [giver, setGiver] = useState(givers[0]?.id ?? '');
  const [asset, setAsset] = useState<AccountAsset>('coins');
  const [amountText, setAmountText] = useState('1');
  const amount = parseAmount(amountText);
  const { busy, status, run } = useAct(onAct);
  const party = givers.find((g) => g.id === giver)?.party;
  const open = ASSETS.filter((a) => needs[a] > given[a] && (party?.kind === 'chog' || a === 'coins'));
  const chosen = open.includes(asset) ? asset : open[0];
  if (!party || !chosen) return null;
  return (
    <form
      className="econ-form"
      aria-label={`Give to the ${PROJECTS[projectId].name}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (amount === null) return;
        void run({ type: 'contribute', projectId, from: party, asset: chosen, amount }, `Thank you! Gave ${amountOf(amount, chosen)}.`);
      }}
    >
      {givers.length > 1 ? (
        <label className="look-pick">
          <span className="setting-label">From</span>
          <select className="select-input" value={giver} onChange={(e) => setGiver(e.target.value)}>
            {givers.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="look-pick">
        <span className="setting-label">What</span>
        <select className="select-input" value={chosen} onChange={(e) => setAsset(e.target.value as AccountAsset)}>
          {open.map((a) => (
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
      <button type="submit" className="button button--quiet button--small" disabled={busy || amount === null}>
        Chip in
      </button>
      <ActionStatus status={status} />
    </form>
  );
}

export function Projects({ world, villagerName, myChogs, onAct }: { world: WorldState; villagerName: string | null; myChogs: AgentState[]; onAct: OnAct }) {
  const givers = [
    ...(villagerName ? [{ id: 'me', label: `${villagerName} (you)`, party: { kind: 'citizen' } as Party }] : []),
    ...myChogs.map((a) => ({ id: a.key, label: a.name, party: { kind: 'chog', key: a.key, expectedEpoch: a.control.epoch } as Party })),
  ];
  return (
    <ul className="projects" aria-label="Shared projects">
      {PROJECT_IDS.map((id) => {
        const project = PROJECTS[id];
        const state = world.projects[id];
        return (
          <li key={id} className="project">
            <p className="project-name">
              {project.name} {state.completedTick !== null ? <span className="tag tag--mine">Built</span> : null}
            </p>
            <p className="setting-hint">{project.effect}</p>
            <dl className="project-needs">
              {ASSETS.filter((a) => project.needs[a] > 0).map((a) => (
                <div key={a} className="need">
                  <dt>{ASSET_LABEL[a]}</dt>
                  <dd>
                    <span className="need-bar" role="img" aria-label={`${ASSET_LABEL[a]} ${state.given[a]} of ${project.needs[a]}`}>
                      <span style={{ width: `${(100 * state.given[a]) / project.needs[a]}%` }} />
                    </span>
                    <span className="need-figure num">
                      {state.given[a]}/{project.needs[a]}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            {state.completedTick === null && givers.length ? <Contribute key={givers.map((g) => g.id).join()} projectId={id} world={world} givers={givers} onAct={onAct} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
