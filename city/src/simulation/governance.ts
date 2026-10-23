// Proposals and votes. Chogs put proposals forward (their holders today, their AI later); citizens who have
// worked a few village days vote, one ballot each. A proposal is open for VOTE_TICKS and closes on the first
// tick after that: it passes with more yes than no and enough turnout, and is then enacted under the
// constitution as it stands at that moment. Pure functions; no clocks or randomness.
import type { AccountEntry, Ballot, CitizenState, Proposal, ProposalChange, PublicChange, WorldState } from '../shared/contracts';
import { CONSTITUTION, checkParamChange } from '../shared/constitution';
import { KEEP_CLOSED_PROPOSALS, PROJECTS, QUORUM_PCT, VOTE_TICKS } from '../shared/rules';
import { accountEntry, canVote } from './citizens';

export const isOpen = (p: Proposal): boolean => p.status === 'open';

/** Ballots needed for a result: QUORUM_PCT of the citizens who can vote, and at least one. */
export function quorumOf(citizens: readonly CitizenState[]): number {
  const eligible = citizens.filter(canVote).length;
  return Math.max(1, Math.ceil((eligible * QUORUM_PCT) / 100));
}

export function tally(p: Proposal, citizens: readonly CitizenState[]): { yes: number; no: number } {
  const present = new Set(citizens.map((c) => c.key));
  let yes = 0;
  let no = 0;
  for (const [key, ballot] of Object.entries(p.votes) as Array<[string, Ballot]>) {
    if (!present.has(key)) continue;
    if (ballot === 'yes') yes += 1;
    else no += 1;
  }
  return { yes, no };
}

/** A short description of a change, for titles and the log. */
export function describeProposalChange(change: ProposalChange): string {
  if (change.kind === 'params') {
    return Object.entries(change.values)
      .map(([id, v]) => `${CONSTITUTION[id as keyof typeof CONSTITUTION].label} to ${v} ${CONSTITUTION[id as keyof typeof CONSTITUTION].unit}`)
      .join(', ');
  }
  return `${change.amount} ${change.asset} from the treasury to the ${PROJECTS[change.projectId].name}`;
}

/** A new proposal, open from `tick` for one village day. */
export function openProposal(world: WorldState, proposer: string, title: string, change: ProposalChange): Proposal {
  return {
    id: `p${world.proposalSeq + 1}`,
    proposer,
    title: title.trim(),
    change,
    openedTick: world.tick,
    closesTick: (BigInt(world.tick) + BigInt(VOTE_TICKS)).toString(),
    votes: {},
    speeches: [],
    status: 'open',
    resolvedTick: null,
    outcome: null,
  };
}

export interface Resolved {
  params: WorldState['params'];
  treasury: WorldState['treasury'];
  projects: WorldState['projects'];
  proposals: Proposal[];
  accounts: AccountEntry[];
  changes: PublicChange[];
}

/** Closes every proposal due at `tick`, in proposal order, enacting those that pass. */
export function resolveProposals(world: WorldState, tick: string): Resolved {
  let { params, treasury, projects } = world;
  const accounts: AccountEntry[] = [];
  const changes: PublicChange[] = [];
  const quorum = quorumOf(world.citizens);
  const proposals = world.proposals.map((p) => {
    if (!isOpen(p) || BigInt(tick) < BigInt(p.closesTick)) return p;
    const { yes, no } = tally(p, world.citizens);
    const close = (status: Exclude<Proposal['status'], 'open'>, outcome: string | null): Proposal => {
      changes.push({ type: 'proposal_closed', proposalId: p.id, status, yes, no, outcome });
      return { ...p, status, resolvedTick: tick, outcome };
    };
    if (yes + no < quorum) return close('rejected', `Too few votes: ${yes + no} of the ${quorum} needed.`);
    if (yes <= no) return close('rejected', yes === no ? 'A tie: proposals need more yes than no.' : 'More voted no than yes.');

    if (p.change.kind === 'params') {
      const checked = checkParamChange(params.values, p.change.values as Record<string, number>);
      if (!checked.ok) return close('failed', `Passed, but no longer allowed: ${checked.problems.join(' ')}`);
      params = { version: (BigInt(params.version) + 1n).toString(), values: checked.values };
      changes.push({ type: 'params_changed', version: params.version, values: params.values });
      return close('passed', null);
    }

    const { projectId, asset, amount } = p.change;
    const project = projects[projectId];
    const need = PROJECTS[projectId].needs[asset] - project.given[asset];
    const held = asset === 'coins' ? treasury.coins : treasury.stores[asset];
    const paid = Math.min(amount, Math.max(0, need), held);
    if (project.completedTick !== null || need <= 0) return close('failed', 'Passed, but the project needs no more of that.');
    if (paid <= 0) return close('failed', "Passed, but the treasury couldn't pay.");
    const causeId = `proposal:${p.id}`;
    accounts.push(accountEntry('treasury', causeId, asset, 'treasury_grant', -paid), accountEntry(`project:${projectId}`, causeId, asset, 'treasury_grant', paid));
    treasury = asset === 'coins' ? { ...treasury, coins: treasury.coins - paid } : { ...treasury, stores: { ...treasury.stores, [asset]: treasury.stores[asset] - paid } };
    const given = { ...project.given, [asset]: project.given[asset] + paid };
    const needs = PROJECTS[projectId].needs;
    const complete = (['wood', 'stone', 'food', 'coins'] as const).every((a) => given[a] >= needs[a]);
    projects = { ...projects, [projectId]: { given, completedTick: complete ? tick : null } };
    const closed = close('passed', paid < amount ? `Paid ${paid} of ${amount}: all that was needed or held.` : null);
    if (complete) changes.push({ type: 'project_completed', projectId });
    return closed;
  });
  // Keep every open proposal and the most recent closed ones.
  const closed = proposals.filter((p) => !isOpen(p));
  const drop = new Set(closed.slice(0, Math.max(0, closed.length - KEEP_CLOSED_PROPOSALS)).map((p) => p.id));
  return { params, treasury, projects, proposals: proposals.filter((p) => !drop.has(p.id)), accounts, changes };
}
