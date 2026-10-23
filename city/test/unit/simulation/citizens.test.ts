import { describe, expect, it } from 'vitest';
import type { AccountEntry, WorldState } from '../../../src/shared/contracts';
import { CONSTITUTION, checkParamChange, defaultParams } from '../../../src/shared/constitution';
import { CITIZEN_GRANT, DAY_TICKS, TREASURY_CAP, VOTE_ACTIVE_DAYS } from '../../../src/shared/rules';
import { worldStateSchema } from '../../../src/shared/schemas';
import { FIXTURE_ACTORS, fixtureGenesisAccounts, makeFixtureWorld } from '../../../src/fixtures/residents';
import { FixtureCityClient } from '../../../src/fixtures/fixture-client';
import { step } from '../../../src/simulation/step';
import {
  admitCitizen,
  applyJobChange,
  applyParamChange,
  canVote,
  citizenAsleep,
  citizenKeyOf,
  reconcileAccounts,
  stepCitizens,
  villagerLookFor,
} from '../../../src/simulation/citizens';

const run = (world: WorldState, ticks: number, books: AccountEntry[]) => {
  for (let i = 0; i < ticks; i += 1) {
    const result = step({ world });
    books.push(...result.accounts);
    world = result.world;
  }
  return world;
};

describe('the constitution', () => {
  it('starts every number at its default, inside its range', () => {
    const params = defaultParams();
    for (const [id, rule] of Object.entries(CONSTITUTION)) {
      expect(params[id as keyof typeof params]).toBe(rule.default);
      expect(rule.default).toBeGreaterThanOrEqual(rule.min);
      expect(rule.default).toBeLessThanOrEqual(rule.max);
    }
  });

  it('lets a change through only within range, by at most one step, on listed numbers', () => {
    const now = defaultParams();
    expect(checkParamChange(now, { wage: 7 })).toEqual({ ok: true, values: { ...now, wage: 7 } });
    expect(checkParamChange(now, { wage: 8 })).toMatchObject({ ok: false, problems: ['Wage can move by at most 2 at a time.'] });
    expect(checkParamChange({ ...now, incomeTaxPct: 40 }, { incomeTaxPct: 45 })).toMatchObject({ ok: false, problems: ['Income tax must stay between 0 and 40.'] });
    expect(checkParamChange(now, { farmYield: 3.5 })).toMatchObject({ ok: false });
    expect(checkParamChange(now, { farmYield: 3 })).toMatchObject({ ok: false, problems: ['Farm yield is already 3.'] });
    expect(checkParamChange(now, { resourceCap: 99 })).toMatchObject({ ok: false, problems: ['"resourceCap" is not a number the constitution lets votes change.'] });
    expect(checkParamChange(now, {})).toMatchObject({ ok: false });
  });

  it('an enacted change bumps the version and changes what Chogs gather', () => {
    const world = makeFixtureWorld({ citizenCount: 0 });
    const enacted = applyParamChange(world, { forestYield: 4 });
    expect(enacted.ok).toBe(true);
    if (!enacted.ok) return;
    expect(enacted.world.params).toEqual({ version: '2', values: { ...defaultParams(), forestYield: 4 } });
    expect(enacted.changes).toEqual([{ type: 'params_changed', version: '2', values: enacted.world.params.values }]);
    expect(applyParamChange(world, { forestYield: 9 })).toMatchObject({ ok: false });
  });
});

describe('citizens', () => {
  it('anyone can join: first free lot, a starting grant on the books, once per address', () => {
    const world = makeFixtureWorld();
    const address = FIXTURE_ACTORS.C.address;
    const joined = admitCitizen(world, { address, name: '  Clover ', look: villagerLookFor(address) });
    expect(joined).toMatchObject({ ok: true, citizen: { key: citizenKeyOf(address), name: 'Clover', lotId: 'c04', job: 'off', coins: CITIZEN_GRANT } });
    if (!joined.ok) return;
    expect(joined.accounts).toEqual([expect.objectContaining({ account: citizenKeyOf(address), asset: 'coins', reason: 'grant', delta: CITIZEN_GRANT })]);
    const again = admitCitizen(joined.world, { address: address.toUpperCase().replace('0X', '0x'), name: 'Other', look: villagerLookFor(address) });
    expect(again).toMatchObject({ ok: true, citizen: { name: 'Clover' }, accounts: [] });
    expect(worldStateSchema.parse(joined.world)).toBeTruthy();
  });

  it('refuses a newcomer when every lot is taken', () => {
    let world = makeFixtureWorld();
    for (let i = 0; world.citizens.length < world.lots.length; i += 1) {
      const address = `0x${(i + 1).toString(16).padStart(40, '0')}`;
      const joined = admitCitizen(world, { address, name: `Villager ${i}`, look: villagerLookFor(address) });
      if (!joined.ok) throw new Error('should fit');
      world = joined.world;
    }
    const address = `0x${'f'.repeat(40)}`;
    expect(admitCitizen(world, { address, name: 'Late', look: villagerLookFor(address) })).toEqual({ ok: false, code: 'DISTRICT_FULL' });
  });

  it('work fills the city stores and pays a wage in new coins, taxed for the treasury', () => {
    const world = makeFixtureWorld();
    const district = stepCitizens(world, '1');
    const nettle = district.citizens.find((c) => c.name === 'Nettle')!;
    // Default wage 5, tax 20%: 1 coin to the treasury, 4 kept.
    expect(nettle).toMatchObject({ location: { kind: 'place', placeId: 'farm' }, coins: CITIZEN_GRANT + 4, activeDays: VOTE_ACTIVE_DAYS + 1 });
    expect(district.treasury).toEqual({ coins: 103, stores: { food: 3, wood: 3, stone: 2 } });
    expect(district.changes).toContainEqual({ type: 'citizen_worked', citizenKey: nettle.key, placeId: 'farm', resource: 'food', amount: 3, wage: 5, tax: 1 });

    const taxed = { ...world, params: { version: '2', values: { ...world.params.values, wage: 10, incomeTaxPct: 30 } } };
    const after = stepCitizens(taxed, '1');
    expect(after.citizens.find((c) => c.name === 'Nettle')!.coins).toBe(CITIZEN_GRANT + 7);
    expect(after.treasury.coins).toBe(109);
    const books = [...fixtureGenesisAccounts(world), ...after.accounts];
    expect(reconcileAccounts({ ...taxed, citizens: after.citizens, treasury: after.treasury }, books)).toEqual([]);
  });

  it('full stores stop paying, a day off stays home, and night sends everyone home', () => {
    const world = makeFixtureWorld();
    const full = { ...world, treasury: { coins: 0, stores: { wood: TREASURY_CAP, stone: TREASURY_CAP, food: TREASURY_CAP } } };
    const idle = stepCitizens(full, '1');
    expect(idle.accounts).toEqual([]);
    expect(idle.citizens.every((c) => c.coins === CITIZEN_GRANT)).toBe(true);

    const off = applyJobChange(world, world.citizens[0]!.key, 'off');
    expect(off.world.citizens[0]).toMatchObject({ job: 'off', jobVersion: '2' });
    expect(applyJobChange(off.world, world.citizens[0]!.key, 'off').world).toBe(off.world);
    expect(stepCitizens(off.world, '1').citizens[0]!.location).toEqual({ kind: 'lot', lotId: 'c01' });

    // Just before dawn every villager is asleep, whatever their bedtime.
    const night = Array.from({ length: DAY_TICKS }, (_, t) => String(t)).find((t) => world.citizens.every((c) => citizenAsleep(c, t)))!;
    const asleep = stepCitizens(world, night);
    expect(asleep.accounts).toEqual([]);
    expect(asleep.citizens.every((c) => c.location.kind === 'lot')).toBe(true);
  });

  it('earns a vote after working on a few different village days; the books balance over a long run', () => {
    const books = fixtureGenesisAccounts(makeFixtureWorld());
    const world = run(makeFixtureWorld(), DAY_TICKS * 4, books);
    for (const c of world.citizens) {
      expect(c.activeDays).toBeGreaterThanOrEqual(VOTE_ACTIVE_DAYS);
      expect(canVote(c)).toBe(true);
    }
    expect(world.treasury.stores.food).toBeGreaterThan(0);
    expect(reconcileAccounts(world, books)).toEqual([]);
    expect(worldStateSchema.parse(world)).toBeTruthy();
  });
});

describe('the fixture client', () => {
  it('lets Citizen C join and pick a job, with idempotency and version fences', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    client.setActor(null);
    expect(await client.joinCity({ name: 'Clover', look: villagerLookFor(FIXTURE_ACTORS.C.address) }, 'join-1')).toEqual({ ok: false, code: 'LOGIN_REQUIRED' });
    client.setActor('C');
    expect(await client.getMyCitizen()).toBeNull();
    const look = villagerLookFor(FIXTURE_ACTORS.C.address);
    const joined = await client.joinCity({ name: 'Clover', look }, 'join-1');
    expect(joined).toMatchObject({ ok: true, citizen: { name: 'Clover', job: 'off' } });
    expect(await client.joinCity({ name: 'Clover', look }, 'join-1')).toEqual(joined);
    expect(await client.joinCity({ name: 'Other', look }, 'join-1')).toEqual({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    await expect(client.joinCity({ name: 'x', look }, 'join-2')).rejects.toThrow();

    expect(await client.setJob({ expectedVersion: '9', job: 'farmhand' }, 'job-1')).toEqual({ ok: false, code: 'JOB_CHANGED' });
    expect(await client.setJob({ expectedVersion: '1', job: 'farmhand' }, 'job-2')).toMatchObject({ ok: true, citizen: { job: 'farmhand', jobVersion: '2' } });
    client.tick();
    expect(await client.getMyCitizen()).toMatchObject({ location: { kind: 'place', placeId: 'farm' }, coins: CITIZEN_GRANT + 4 });

    // Holders can be citizens too; a holder who hasn't joined has no villager.
    client.setActor('A');
    expect(await client.getMyCitizen()).toBeNull();
    expect(await client.setJob({ expectedVersion: '1', job: 'farmhand' }, 'job-3')).toEqual({ ok: false, code: 'NOT_A_CITIZEN' });

    const snapshot = await client.getSnapshot();
    expect(snapshot.recentEvents.map((e) => e.type)).toEqual(expect.arrayContaining(['citizen_joined', 'job_changed']));
    expect(reconcileAccounts(snapshot.world, client.accountLog())).toEqual([]);
  });

  it('enacts a constitutional change, and refuses one outside the rules', () => {
    const client = new FixtureCityClient({ autoStart: false });
    expect(client.enactParams({ wage: 7 })).toEqual({ ok: true });
    expect(client.enactParams({ wage: 15 })).toMatchObject({ ok: false });
  });
});

describe("Newcomers' Row", () => {
  it('has 30 lots, each with its own spot on the islet, none overlapping', async () => {
    const { LOTS } = await import('../../../src/web/world3d/District3D');
    const lots = makeFixtureWorld().lots;
    expect(lots).toHaveLength(30);
    expect(Object.keys(LOTS).sort()).toEqual(lots.map((l) => l.id).sort());
    const spots = Object.values(LOTS);
    for (const [i, a] of spots.entries()) {
      for (const b of spots.slice(i + 1)) expect(Math.abs(a.x - b.x) >= 1.5 || Math.abs(a.z - b.z) >= 1.76).toBe(true);
    }
  });
});
