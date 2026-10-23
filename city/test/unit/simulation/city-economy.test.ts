import { describe, expect, it } from 'vitest';
import type { AccountEntry, CityAction, LedgerEntry, WorldState } from '../../../src/shared/contracts';
import { FOUNTAIN_FUN, GENESIS_TREASURY_COINS, PROJECTS, RESOURCE_CAP } from '../../../src/shared/rules';
import { worldStateSchema } from '../../../src/shared/schemas';
import { FIXTURE_ACTORS, fixtureGenesisAccounts, makeFixtureWorld } from '../../../src/fixtures/residents';
import { FixtureCityClient } from '../../../src/fixtures/fixture-client';
import { admitCitizen, applyJobChange, citizenKeyOf, reconcileAccounts, villagerLookFor } from '../../../src/simulation/citizens';
import { applyAction, marketFee, marketPrices } from '../../../src/simulation/economy';
import { canonicalJson, canonicalJsonReference, step } from '../../../src/simulation/step';

const A = FIXTURE_ACTORS.A.address;
const C = FIXTURE_ACTORS.C.address;

/** A fixture world plus its books, with Citizen C joined and every Chog holding some coins. */
function setup() {
  let world = makeFixtureWorld();
  const accounts: AccountEntry[] = fixtureGenesisAccounts(world);
  const ledger: LedgerEntry[] = [];
  const joined = admitCitizen(world, { address: C, name: 'Clover', look: villagerLookFor(C) });
  if (!joined.ok) throw new Error('join');
  world = joined.world;
  accounts.push(...joined.accounts);
  let n = 0;
  const act = (actor: string, action: CityAction) => {
    const applied = applyAction(world, actor, action, `test:${(n += 1)}`);
    if (applied.ok) {
      world = applied.world;
      accounts.push(...applied.accounts);
      ledger.push(...applied.ledger);
    }
    return applied;
  };
  const tick = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      const result = step({ world });
      world = result.world;
      accounts.push(...result.accounts);
      ledger.push(...result.ledger);
    }
  };
  return { get world() { return world; }, set world(w: WorldState) { world = w; }, accounts, ledger, act, tick };
}

const mossy = (world: WorldState) => world.agents[0]!; // held by A
const bramble = (world: WorldState) => world.agents[2]!; // also held by A
const pebble = (world: WorldState) => world.agents[1]!; // held by B
const chog = (world: WorldState, i: number) => ({ kind: 'chog' as const, key: world.agents[i]!.key, expectedEpoch: '1' });

describe('the Plaza market', () => {
  it('prices rise when the treasury is short and fall when it is full, with the fee as the spread', () => {
    const s = setup();
    expect(marketPrices(s.world, 'wood')).toEqual({ mid: 6, buy: 7, sell: 5 });
    const stocked = { ...s.world, treasury: { ...s.world.treasury, stores: { wood: 150, stone: 0, food: 0 } } };
    expect(marketPrices(stocked, 'wood').mid).toBe(2);
    expect(marketFee(s.world)).toBe(10);
  });

  it("a holder sells their Chog's free materials for coins and buys them back, through both books", () => {
    const s = setup();
    const wood = mossy(s.world).inventory.wood.total;
    expect(s.act(A, { type: 'trade', chog: mossy(s.world).key, expectedEpoch: '1', side: 'sell', resource: 'wood', amount: 2 })).toMatchObject({ ok: true });
    expect(mossy(s.world)).toMatchObject({ coins: 10, inventory: { wood: { total: wood - 2 } } });
    expect(s.world.treasury).toMatchObject({ coins: GENESIS_TREASURY_COINS - 10, stores: { wood: 2 } });
    expect(s.act(A, { type: 'trade', chog: mossy(s.world).key, expectedEpoch: '1', side: 'buy', resource: 'wood', amount: 1 })).toMatchObject({ ok: true });
    expect(mossy(s.world).coins).toBe(10 - marketPrices({ ...s.world, treasury: { ...s.world.treasury, stores: { ...s.world.treasury.stores, wood: 2 } } }, 'wood').buy);
    expect(reconcileAccounts(s.world, s.accounts)).toEqual([]);
  });

  it('refuses what the rules forbid', () => {
    const s = setup();
    const key = mossy(s.world).key;
    expect(s.act(FIXTURE_ACTORS.B.address, { type: 'trade', chog: key, expectedEpoch: '1', side: 'sell', resource: 'wood', amount: 1 })).toEqual({ ok: false, code: 'NOT_CONTROLLER' });
    expect(s.act(A, { type: 'trade', chog: key, expectedEpoch: '2', side: 'sell', resource: 'wood', amount: 1 })).toEqual({ ok: false, code: 'CONTROL_CHANGED' });
    expect(s.act(A, { type: 'trade', chog: key, expectedEpoch: '1', side: 'sell', resource: 'wood', amount: 9 })).toEqual({ ok: false, code: 'NOT_ENOUGH' });
    expect(s.act(A, { type: 'trade', chog: key, expectedEpoch: '1', side: 'buy', resource: 'stone', amount: 1 })).toEqual({ ok: false, code: 'MARKET_EMPTY' });
    const broke = { ...s.world, treasury: { ...s.world.treasury, coins: 0 } };
    expect(applyAction(broke, A, { type: 'trade', chog: key, expectedEpoch: '1', side: 'sell', resource: 'wood', amount: 1 }, 'x')).toEqual({ ok: false, code: 'TREASURY_EMPTY' });
  });
});

describe('gifts', () => {
  it('coins between anyone, materials between Chogs only, never more than you have', () => {
    const s = setup();
    const clover = citizenKeyOf(C);
    expect(s.act(C, { type: 'gift', from: { kind: 'citizen' }, to: mossy(s.world).key, asset: 'coins', amount: 4 })).toMatchObject({ ok: true });
    expect(mossy(s.world).coins).toBe(4);
    expect(s.act(A, { type: 'gift', from: chog(s.world, 0), to: clover, asset: 'coins', amount: 1 })).toMatchObject({ ok: true });
    expect(s.world.citizens.find((c) => c.key === clover)!.coins).toBe(7);
    expect(s.act(A, { type: 'gift', from: chog(s.world, 0), to: pebble(s.world).key, asset: 'wood', amount: 2 })).toMatchObject({ ok: true });
    expect(pebble(s.world).inventory.wood.total).toBe(6);
    expect(s.act(A, { type: 'gift', from: chog(s.world, 0), to: clover, asset: 'wood', amount: 1 })).toEqual({ ok: false, code: 'NOT_ALLOWED' });
    expect(s.act(C, { type: 'gift', from: { kind: 'citizen' }, to: clover, asset: 'coins', amount: 1 })).toEqual({ ok: false, code: 'NOT_ALLOWED' });
    expect(s.act(C, { type: 'gift', from: { kind: 'citizen' }, to: mossy(s.world).key, asset: 'coins', amount: 99 })).toEqual({ ok: false, code: 'NOT_ENOUGH' });
    expect(s.act(FIXTURE_ACTORS.B.address, { type: 'gift', from: { kind: 'citizen' }, to: clover, asset: 'coins', amount: 1 })).toEqual({ ok: false, code: 'NOT_A_CITIZEN' });
    const full = { ...s.world, agents: s.world.agents.map((a, i) => (i === 1 ? { ...a, inventory: { ...a.inventory, wood: { total: RESOURCE_CAP, reserved: 0 } } } : a)) };
    expect(applyAction(full, A, { type: 'gift', from: chog(s.world, 0), to: pebble(s.world).key, asset: 'wood', amount: 1 }, 'x')).toEqual({ ok: false, code: 'NO_ROOM' });
    expect(reconcileAccounts(s.world, s.accounts)).toEqual([]);
  });
});

describe('Chogs hiring citizens', () => {
  it("a hired citizen works for the Chog: output to its stores, wage from its coins, tax to the treasury", () => {
    const s = setup();
    const clover = citizenKeyOf(C);
    s.act(A, { type: 'trade', chog: mossy(s.world).key, expectedEpoch: '1', side: 'sell', resource: 'food', amount: 4 });
    const coins = mossy(s.world).coins;
    expect(s.act(A, { type: 'offer', chog: mossy(s.world).key, expectedEpoch: '1', offer: { job: 'quarrier', wage: 4 } })).toMatchObject({ ok: true });
    expect(s.act(C, { type: 'take_offer', employer: mossy(s.world).key })).toMatchObject({ ok: true });
    expect(s.world.citizens.find((c) => c.key === clover)).toMatchObject({ employer: mossy(s.world).key, job: 'quarrier' });
    // Only one citizen per offer.
    const other = `0x${'d'.repeat(40)}`;
    const joined = admitCitizen(s.world, { address: other, name: 'Dock', look: villagerLookFor(other) });
    if (!joined.ok) throw new Error('join');
    expect(applyAction(joined.world, other, { type: 'take_offer', employer: mossy(s.world).key }, 'x')).toEqual({ ok: false, code: 'OFFER_TAKEN' });

    const stone = mossy(s.world).inventory.stone.total;
    s.tick();
    expect(mossy(s.world).inventory.stone.total).toBeGreaterThan(stone);
    expect(mossy(s.world).coins).toBe(coins - 4);
    expect(s.world.citizens.find((c) => c.key === clover)!.coins).toBe(10 + 4 - 0); // 20% of 4 rounds down to 0
    expect(reconcileAccounts(s.world, s.accounts)).toEqual([]);
  });

  it('a Chog that cannot pay gets no work; withdrawing the offer or a sale sends the citizen back to the city', () => {
    const s = setup();
    const clover = citizenKeyOf(C);
    s.act(A, { type: 'offer', chog: mossy(s.world).key, expectedEpoch: '1', offer: { job: 'farmhand', wage: 3 } });
    s.act(C, { type: 'take_offer', employer: mossy(s.world).key });
    s.tick();
    expect(s.world.citizens.find((c) => c.key === clover)!.coins).toBe(10); // Mossy has no coins yet
    s.act(A, { type: 'offer', chog: mossy(s.world).key, expectedEpoch: '1', offer: null });
    expect(s.world.citizens.find((c) => c.key === clover)).toMatchObject({ employer: null, job: 'farmhand' });
    // Picking a city job also leaves an employer.
    s.act(A, { type: 'offer', chog: mossy(s.world).key, expectedEpoch: '1', offer: { job: 'farmhand', wage: 3 } });
    s.act(C, { type: 'take_offer', employer: mossy(s.world).key });
    s.world = applyJobChange(s.world, clover, 'farmhand').world;
    expect(s.world.citizens.find((c) => c.key === clover)!.employer).toBeNull();
    expect(s.act(A, { type: 'offer', chog: mossy(s.world).key, expectedEpoch: '1', offer: { job: 'farmhand', wage: 11 } })).toEqual({ ok: false, code: 'NOT_ALLOWED' });
  });
});

describe('shared projects', () => {
  it('collects only what is still needed, from Chogs and citizens, and finishes with an effect', () => {
    const s = setup();
    const needs = PROJECTS.fountain.needs;
    expect(s.act(C, { type: 'contribute', projectId: 'fountain', from: { kind: 'citizen' }, asset: 'coins', amount: 5 })).toMatchObject({ ok: true });
    expect(s.act(C, { type: 'contribute', projectId: 'fountain', from: { kind: 'citizen' }, asset: 'wood', amount: 1 })).toEqual({ ok: false, code: 'NOT_ALLOWED' });
    expect(s.act(A, { type: 'contribute', projectId: 'fountain', from: chog(s.world, 0), asset: 'wood', amount: 3 })).toMatchObject({ ok: true });
    expect(s.world.projects.fountain.given).toEqual({ wood: 3, stone: 0, food: 0, coins: 5 });
    expect(s.act(A, { type: 'contribute', projectId: 'fountain', from: chog(s.world, 0), asset: 'food', amount: 1 })).toEqual({ ok: false, code: 'NOT_NEEDED' });

    // Finish it directly, then check the overflow is capped and the fountain works.
    const almost = { ...s.world, projects: { ...s.world.projects, fountain: { given: { ...needs, coins: needs.coins - 1 }, completedTick: null } } };
    const rich = { ...almost, citizens: almost.citizens.map((c) => (c.key === citizenKeyOf(C) ? { ...c, coins: 50 } : c)) };
    const done = applyAction(rich, C, { type: 'contribute', projectId: 'fountain', from: { kind: 'citizen' }, asset: 'coins', amount: 20 }, 'x');
    expect(done).toMatchObject({ ok: true, changes: [{ type: 'contributed', amount: 1 }, { type: 'project_completed', projectId: 'fountain' }] });
    if (!done.ok) return;
    expect(done.world.projects.fountain.completedTick).toBe(s.world.tick);
    expect(applyAction(done.world, C, { type: 'contribute', projectId: 'fountain', from: { kind: 'citizen' }, asset: 'coins', amount: 1 }, 'y')).toEqual({ ok: false, code: 'NOT_NEEDED' });
    expect(reconcileAccounts(s.world, s.accounts)).toEqual([]);
  });

  it('the fountain adds fun at the Plaza and the Market Hall halves the fee', () => {
    const base = makeFixtureWorld();
    const built = (id: 'fountain' | 'market_hall') => ({ ...base.projects[id], completedTick: '0' });
    const social = base.agents.findIndex((a) => a.policy.focus === 'social');
    // Tick 1 sends social Chogs to the Plaza.
    const plain = step({ world: base }).world.agents[social]!;
    const withFountain = step({ world: { ...base, projects: { ...base.projects, fountain: built('fountain') } } }).world.agents[social]!;
    expect(plain.location).toEqual({ kind: 'place', placeId: 'plaza' });
    expect(withFountain.needs.fun - plain.needs.fun).toBe(Math.min(FOUNTAIN_FUN, 100 - plain.needs.fun));
    expect(marketFee({ ...base, projects: { ...base.projects, market_hall: built('market_hall') } })).toBe(5);
  });
});

describe('the whole economy', () => {
  it('stays balanced and valid through trades, gifts, hiring and work over several days', () => {
    const s = setup();
    for (let day = 0; day < 4; day += 1) {
      s.act(A, { type: 'trade', chog: mossy(s.world).key, expectedEpoch: '1', side: 'sell', resource: 'food', amount: 1 });
      s.act(A, { type: 'offer', chog: bramble(s.world).key, expectedEpoch: '1', offer: { job: 'woodcutter', wage: 2 } });
      s.act(A, { type: 'gift', from: chog(s.world, 0), to: bramble(s.world).key, asset: 'coins', amount: 2 });
      s.act(C, { type: 'take_offer', employer: bramble(s.world).key });
      s.act(C, { type: 'contribute', projectId: 'market_hall', from: { kind: 'citizen' }, asset: 'coins', amount: 1 });
      s.tick(36);
    }
    expect(reconcileAccounts(s.world, s.accounts)).toEqual([]);
    expect(worldStateSchema.parse(s.world)).toBeTruthy();
    for (const a of s.world.agents) expect(a.coins).toBeGreaterThanOrEqual(0);
    for (const c of s.world.citizens) expect(c.coins).toBeGreaterThanOrEqual(0);
  });

  it('the fast world hash reads exactly like the original', () => {
    const s = setup();
    s.tick(40);
    expect(canonicalJson(s.world)).toBe(canonicalJsonReference(s.world));
    expect(canonicalJson([{ b: 1, a: undefined, c: [null, 'x'] }])).toBe(canonicalJsonReference([{ b: 1, a: undefined, c: [null, 'x'] }]));
  });

  it('runs through the fixture client with idempotency, and Chogs sold keep their coins but drop their offer', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    const world = (await client.getSnapshot()).world;
    const key = world.agents[0]!.key;
    expect(await client.act({ type: 'trade', chog: key, expectedEpoch: '1', side: 'sell', resource: 'wood', amount: 1 }, 'k1')).toEqual({ ok: true });
    expect(await client.act({ type: 'trade', chog: key, expectedEpoch: '1', side: 'sell', resource: 'wood', amount: 1 }, 'k1')).toEqual({ ok: true });
    expect(await client.act({ type: 'trade', chog: key, expectedEpoch: '1', side: 'sell', resource: 'wood', amount: 2 }, 'k1')).toEqual({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    await client.act({ type: 'offer', chog: key, expectedEpoch: '1', offer: { job: 'farmhand', wage: 2 } }, 'k2');
    client.simulateTransfer(key);
    const after = (await client.getSnapshot()).world.agents[0]!;
    expect(after).toMatchObject({ coins: 5, offer: null });
    expect(reconcileAccounts((await client.getSnapshot()).world, client.accountLog())).toEqual([]);
  });
});
