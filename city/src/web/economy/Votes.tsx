// Proposals: a holder puts one forward through their Chog; villagers who can vote say yes or no.
import { useState } from 'react';
import { PARAM_IDS, PROJECT_IDS, type AccountAsset, type AgentState, type Ballot, type CitizenState, type ParamId, type ProjectId, type ProposalChange, type WorldState } from '../../shared/contracts';
import { CONSTITUTION } from '../../shared/constitution';
import { PROJECTS, VOTE_ACTIVE_DAYS } from '../../shared/rules';
import { canVote } from '../../simulation/citizens';
import { describeProposalChange, quorumOf, tally } from '../../simulation/governance';
import { ActionStatus, AmountInput, ASSET_LABEL, parseAmount, useAct, type OnAct } from './actions';

const STATUS_LABEL = { open: 'Open', passed: 'Passed', rejected: 'Not passed', failed: 'Could not apply' } as const;

/** Holder form on a Chog: change one rule by an allowed step, or ask the treasury to fund a project. */
export function ProposeForm({ agent, world, onAct }: { agent: AgentState; world: WorldState; onAct: OnAct }) {
  const values = world.params.values;
  const [kind, setKind] = useState<'params' | 'fund'>('params');
  const [param, setParam] = useState<ParamId>('wage');
  const [valueText, setValueText] = useState(String(values.wage + CONSTITUTION.wage.maxStep));
  const [projectId, setProjectId] = useState<ProjectId>('fountain');
  const [asset, setAsset] = useState<AccountAsset>('coins');
  const [amountText, setAmountText] = useState('10');
  const [title, setTitle] = useState('');
  const { busy, status, run } = useAct(onAct);
  const rule = CONSTITUTION[param];
  const value = /^\d{1,3}$/.test(valueText.trim()) ? Number(valueText.trim()) : null;
  const amount = parseAmount(amountText);
  const change: ProposalChange | null =
    kind === 'params' ? (value === null ? null : { kind, values: { [param]: value } }) : amount === null ? null : { kind, projectId, asset, amount };
  const finalTitle = title.trim() || (change ? describeProposalChange(change) : '');

  return (
    <form
      className="econ-form propose"
      aria-label="Propose for the city"
      onSubmit={(e) => {
        e.preventDefault();
        if (!change) return;
        void run({ type: 'propose', chog: agent.key, expectedEpoch: agent.control.epoch, title: finalTitle.slice(0, 80), change }, 'Proposed. Villagers have one village day to vote.');
      }}
    >
      <label className="look-pick">
        <span className="setting-label">Proposal</span>
        <select className="select-input" value={kind} onChange={(e) => setKind(e.target.value as 'params' | 'fund')}>
          <option value="params">Change a rule</option>
          <option value="fund">Fund a project from the treasury</option>
        </select>
      </label>
      {kind === 'params' ? (
        <>
          <label className="look-pick">
            <span className="setting-label">Rule</span>
            <select
              className="select-input"
              value={param}
              onChange={(e) => {
                const next = e.target.value as ParamId;
                setParam(next);
                setValueText(String(Math.min(CONSTITUTION[next].max, values[next] + CONSTITUTION[next].maxStep)));
              }}
            >
              {PARAM_IDS.map((id) => (
                <option key={id} value={id}>
                  {CONSTITUTION[id].label}
                </option>
              ))}
            </select>
          </label>
          <label className="look-pick econ-amount">
            <span className="setting-label">New value</span>
            <input className="text-input" type="number" inputMode="numeric" min={rule.min} max={rule.max} value={valueText} onChange={(e) => setValueText(e.target.value)} />
          </label>
          <p className="setting-hint econ-wide">
            Now {values[param]} {rule.unit}. Allowed {rule.min}–{rule.max}, moving at most {rule.maxStep} per vote.
          </p>
        </>
      ) : (
        <>
          <label className="look-pick">
            <span className="setting-label">Project</span>
            <select className="select-input" value={projectId} onChange={(e) => setProjectId(e.target.value as ProjectId)}>
              {PROJECT_IDS.filter((id) => world.projects[id].completedTick === null).map((id) => (
                <option key={id} value={id}>
                  {PROJECTS[id].name}
                </option>
              ))}
            </select>
          </label>
          <label className="look-pick">
            <span className="setting-label">What</span>
            <select className="select-input" value={asset} onChange={(e) => setAsset(e.target.value as AccountAsset)}>
              {(['coins', 'wood', 'stone', 'food'] as const).map((a) => (
                <option key={a} value={a}>
                  {ASSET_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="look-pick econ-amount">
            <span className="setting-label">Amount</span>
            <AmountInput value={amountText} max={500} onChange={setAmountText} />
          </label>
        </>
      )}
      <label className="look-pick econ-wide">
        <span className="setting-label">Title</span>
        <input className="text-input" maxLength={80} placeholder={change ? describeProposalChange(change) : ''} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button type="submit" className="button button--quiet button--small" disabled={busy || !change}>
        Propose
      </button>
      <ActionStatus status={status} />
    </form>
  );
}

/** Open votes and recent results. Villagers who can vote get Yes and No. */
export function Votes({ world, me, onAct }: { world: WorldState; me: CitizenState | null; onAct: OnAct }) {
  const { busy, status, run } = useAct(onAct);
  const proposals = [...world.proposals].reverse();
  const quorum = quorumOf(world.citizens);
  const name = (key: string) => world.agents.find((a) => a.key === key)?.name ?? 'A Chog';
  const voter = me && canVote(me);
  const cast = (id: string, ballot: Ballot) => void run({ type: 'vote', proposalId: id, ballot }, ballot === 'yes' ? 'You voted yes.' : 'You voted no.');

  return (
    <div className="votes">
      {me && !canVote(me) ? (
        <p className="readonly-note">You can vote after working on {VOTE_ACTIVE_DAYS} different village days ({me.activeDays} so far).</p>
      ) : null}
      {!me ? <p className="readonly-note">Villagers vote. Chogs propose and debate at the morning council, guided by their holders.</p> : null}
      {proposals.length ? (
        <ul className="projects" aria-label="Proposals">
          {proposals.map((p) => {
            const { yes, no } = tally(p, world.citizens);
            const left = Number(BigInt(p.closesTick) - BigInt(world.tick));
            const mine = me ? p.votes[me.key] : undefined;
            return (
              <li key={p.id} className="project">
                <p className="project-name">
                  {p.title} <span className={`tag${p.status === 'passed' ? ' tag--mine' : ''}`}>{STATUS_LABEL[p.status]}</span>
                </p>
                <p className="setting-hint">
                  By {name(p.proposer)} · {describeProposalChange(p.change)}
                </p>
                <p className="vote-tally num">
                  {yes} yes · {no} no
                  {p.status === 'open' ? ` · needs ${quorum} ${quorum === 1 ? 'vote' : 'votes'} · closes in ${Math.max(0, left)} ${left === 1 ? 'tick' : 'ticks'}` : ''}
                </p>
                {p.outcome ? <p className="setting-hint">{p.outcome}</p> : null}
                {p.speeches.length ? (
                  <ul className="speeches" aria-label={`Debate on ${p.title}`}>
                    {p.speeches.map((s) => (
                      <li key={s.agentKey} className={`speech speech--${s.stance}`}>
                        <span className="speech-who">
                          {name(s.agentKey)} <span className="speech-stance">{s.stance}</span>
                          {s.by !== 'holder' ? <span className="speech-by">{s.by === 'ai' ? 'AI' : 'rules'}</span> : null}
                        </span>
                        <q className="speech-text">{s.text}</q>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {p.status === 'open' && voter ? (
                  <div className="market-buttons vote-buttons" role="group" aria-label={`Vote on ${p.title}`}>
                    {mine ? <span className="setting-hint">Your vote: {mine}</span> : null}
                    <button type="button" className="button button--quiet button--small" aria-pressed={mine === 'yes'} disabled={busy} onClick={() => cast(p.id, 'yes')}>
                      Yes
                    </button>
                    <button type="button" className="button button--quiet button--small" aria-pressed={mine === 'no'} disabled={busy} onClick={() => cast(p.id, 'no')}>
                      No
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="setting-hint">No proposals yet.</p>
      )}
      <ActionStatus status={status} />
    </div>
  );
}
