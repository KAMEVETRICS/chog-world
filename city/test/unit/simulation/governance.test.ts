import { describe, expect, it } from 'vitest';
import type { AccountEntry, CityAction, WorldState } from '../../../src/shared/contracts';
import { GENESIS_TREASURY_COINS, VOTE_TICKS } from '../../../src/shared/rules';
import { worldStateSchema } from '../../../src/shared/schemas';
import { FIXTURE_ACTORS, fixtureGenesisAccounts, makeFixtureWorld } from '../../../src/fixtures/residents';
import { FixtureCityClient } from '../../../src/fixtures/fixture-client';
import { admitCitizen, reconcileAccounts, villagerLookFor } from '../../../src/simulation/citizens';
import { applyAction } from '../../../src/simulation/economy';
import { quorumOf } from '../../../src/simulation/governance';
import { step } from '../../../src/simulation/step';

const A = FIXTURE_ACTORS.A.address;
const B = FIXTURE_ACTORS.B.address;
// The seeded villagers can already vote.
const NETTLE = '0x00000000000000000000000000000000c171ee01';
const BASIL = '0x00000000000000000000000000000000c171ee02';
const POPPY = '0x00000000000000000000000000000000c171ee03';

function setup() {
  let world = makeFixtureWorld();
  const accounts: AccountEntry[] = fixtureGenesisAccounts(world);
  let n = 0;
  const act = (actor: string, action: CityAction) => {
    const applied = applyAction(world, actor, action, `t:${(n += 1)}`);
    if (applied.ok) {
      world = applied.world;
      accounts.push(...applied.accounts);
    }
    return applied;
  };
  const tick = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      const r = step({ world });
      world = r.world;
      accounts.push(...r.accounts);
    }
  };
  return { get world() { return world; }, set world(w: WorldState) { world = w; }, accounts, act, tick };
}

const mossy = (w: WorldState) => w.agents[0]!;
const propose = (w: WorldState, title: string, change: Extract<CityAction, { type: 'propose' }>['change']): CityAction => ({ type: 'propose', chog: mossy(w).key, expectedEpoch: '1', title, change });

describe('proposals', () => {
  it("are put forward by a Chog's holder, checked against the constitution, one open per Chog", () => {
    const s = setup();
    expect(s.act(B, propose(s.world, 'Higher wages', { kind: 'params', values: { wage: 7 } }))).toEqual({ ok: false, code: 'NOT_CONTROLLER' });
    expect(s.act(A, propose(s.world, 'Way higher wages', { kind: 'params', values: { wage: 9 } }))).toEqual({ ok: false, code: 'NOT_ALLOWED' });
    expect(s.act(A, propose(s.world, 'Higher wages', { kind: 'params', values: { wage: 7 } }))).toMatchObject({ ok: true });
    expect(s.world.proposals).toEqual([
      expect.objectContaining({ id: 'p1', proposer: mossy(s.world).key, status: 'open', openedTick: '0', closesTick: String(VOTE_TICKS), votes: {} }),
    ]);
    expect(s.act(A, propose(s.world, 'Cheaper market', { kind: 'params', values: { marketFeePct: 5 } }))).toEqual({ ok: false, code: 'TOO_MANY_PROPOSALS' });
    expect(s.act(A, { type: 'propose', chog: s.world.agents[2]!.key, expectedEpoch: '1', title: 'Fund the fountain', change: { kind: 'fund', projectId: 'fountain', asset: 'coins', amount: 30 } })).toMatchObject({ ok: true });
    expect(s.world.proposals.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(worldStateSchema.parse(s.world)).toBeTruthy();
  });

  it('votes come from citizens who have worked a few days; the latest ballot counts until the vote closes', () => {
    const s = setup();
    s.act(A, propose(s.world, 'Higher wages', { kind: 'params', values: { wage: 7 } }));
    expect(s.act(A, { type: 'vote', proposalId: 'p1', ballot: 'yes' })).toEqual({ ok: false, code: 'NOT_A_CITIZEN' });
    const joined = admitCitizen(s.world, { address: FIXTURE_ACTORS.C.address, name: 'Clover', look: villagerLookFor(FIXTURE_ACTORS.C.address) });
    if (!joined.ok) throw new Error('join');
    s.world = joined.world;
    expect(s.act(FIXTURE_ACTORS.C.address, { type: 'vote', proposalId: 'p1', ballot: 'yes' })).toEqual({ ok: false, code: 'CANT_VOTE_YET' });
    expect(s.act(NETTLE, { type: 'vote', proposalId: 'p1', ballot: 'no' })).toMatchObject({ ok: true });
    expect(s.act(NETTLE, { type: 'vote', proposalId: 'p1', ballot: 'yes' })).toMatchObject({ ok: true });
    expect(s.world.proposals[0]!.votes).toEqual({ [`citizen:${NETTLE}`]: 'yes' });
    expect(s.act(NETTLE, { type: 'vote', proposalId: 'p9', ballot: 'yes' })).toEqual({ ok: false, code: 'NOT_FOUND' });
    s.tick(VOTE_TICKS);
    expect(s.act(BASIL, { type: 'vote', proposalId: 'p1', ballot: 'yes' })).toEqual({ ok: false, code: 'VOTE_CLOSED' });
  });

  it('passes with more yes than no and enough turnout, and the change applies from the next tick', () => {
    const s = setup();
    s.act(A, propose(s.world, 'Higher wages', { kind: 'params', values: { wage: 7 } }));
    s.act(NETTLE, { type: 'vote', proposalId: 'p1', ballot: 'yes' });
    s.act(BASIL, { type: 'vote', proposalId: 'p1', ballot: 'yes' });
    s.act(POPPY, { type: 'vote', proposalId: 'p1', ballot: 'no' });
    s.tick(VOTE_TICKS - 1);
    expect(s.world.proposals[0]!.status).toBe('open');
    s.tick();
    expect(s.world.proposals[0]).toMatchObject({ status: 'passed', resolvedTick: String(VOTE_TICKS), outcome: null });
    expect(s.world.params).toMatchObject({ version: '2', values: { wage: 7 } });
    expect(reconcileAccounts(s.world, s.accounts)).toEqual([]);
  });

  it('is rejected on a tie, on more no, or with too few voters', () => {
    expect(quorumOf(makeFixtureWorld().citizens)).toBe(1);
    const tie = setup();
    tie.act(A, propose(tie.world, 'Higher wages', { kind: 'params', values: { wage: 7 } }));
    tie.act(NETTLE, { type: 'vote', proposalId: 'p1', ballot: 'yes' });
    tie.act(BASIL, { type: 'vote', proposalId: 'p1', ballot: 'no' });
    tie.tick(VOTE_TICKS);
    expect(tie.world.proposals[0]).toMatchObject({ status: 'rejected', outcome: 'A tie: proposals need more yes than no.' });
    expect(tie.world.params.values.wage).toBe(5);

    const empty = setup();
    empty.act(A, propose(empty.world, 'Higher wages', { kind: 'params', values: { wage: 7 } }));
    empty.tick(VOTE_TICKS);
    expect(empty.world.proposals[0]).toMatchObject({ status: 'rejected', outcome: 'Too few votes: 0 of the 1 needed.' });
  });

  it('fails if what passed is no longer allowed when it would apply', () => {
    const s = setup();
    s.act(A, propose(s.world, 'Wage 7', { kind: 'params', values: { wage: 7 } }));
    s.act(A, { type: 'propose', chog: s.world.agents[2]!.key, expectedEpoch: '1', title: 'Wage 3', change: { kind: 'params', values: { wage: 3 } } });
    for (const id of ['p1', 'p2']) s.act(NETTLE, { type: 'vote', proposalId: id, ballot: 'yes' });
    s.tick(VOTE_TICKS);
    // p1 moves the wage to 7 first; from 7, a move to 3 is a step of 4 and the constitution allows 2.
    expect(s.world.proposals.map((p) => p.status)).toEqual(['passed', 'failed']);
    expect(s.world.proposals[1]!.outcome).toMatch(/no longer allowed: Wage can move by at most 2/);
    expect(s.world.params.values.wage).toBe(7);
  });

  it('a passed funding proposal pays from the treasury into the project, on the books', () => {
    const s = setup();
    s.act(A, propose(s.world, 'Fund the fountain', { kind: 'fund', projectId: 'fountain', asset: 'coins', amount: 30 }));
    s.act(NETTLE, { type: 'vote', proposalId: 'p1', ballot: 'yes' });
    s.tick(VOTE_TICKS);
    expect(s.world.proposals[0]!.status).toBe('passed');
    expect(s.world.projects.fountain.given.coins).toBe(30);
    // The treasury paid 30 and collected one coin of tax per villager per working tick meanwhile.
    expect(s.world.treasury.coins).toBeLessThan(GENESIS_TREASURY_COINS + 3 * VOTE_TICKS - 30 + 1);
    expect(reconcileAccounts(s.world, s.accounts)).toEqual([]);
  });

  it('runs through the fixture client, and skipping a day closes the vote', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    const w = (await client.getSnapshot()).world;
    expect(await client.act(propose(w, 'Cheaper market', { kind: 'params', values: { marketFeePct: 5 } }), 'k1')).toEqual({ ok: true });
    client.skipDay();
    const after = (await client.getSnapshot()).world;
    expect(after.proposals[0]).toMatchObject({ status: 'rejected' });
    expect(reconcileAccounts(after, client.accountLog())).toEqual([]);
  });
});
