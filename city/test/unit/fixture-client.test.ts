import { describe, expect, it } from 'vitest';
import { FixtureCityClient } from '../../src/fixtures/fixture-client';
import type { CityEvent } from '../../src/shared/contracts';

const client = () => new FixtureCityClient({ autoStart: false });

async function firstOwned(c: FixtureCityClient) {
  const [agent] = await c.getMyAgents();
  return agent!;
}

describe('FixtureCityClient', () => {
  it('saves a policy for the controller and replays idempotently', async () => {
    const c = client();
    const agent = await firstOwned(c);
    const request = {
      expectedVersion: agent.policy.version,
      expectedEpoch: agent.control.epoch,
      active: false,
      focus: agent.policy.focus,
      homeStyle: agent.policy.homeStyle,
    };
    const first = await c.updatePolicy(agent.key, request, 'k1');
    expect(first).toMatchObject({ ok: true });
    expect(await c.updatePolicy(agent.key, request, 'k1')).toEqual(first);
    expect(await c.updatePolicy(agent.key, { ...request, active: true }, 'k1')).toEqual({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('rejects stale versions, stale epochs and other holders', async () => {
    const c = client();
    const agent = await firstOwned(c);
    const base = {
      expectedVersion: agent.policy.version,
      expectedEpoch: agent.control.epoch,
      active: true,
      focus: 'gatherer' as const,
      homeStyle: agent.policy.homeStyle,
    };
    expect(await c.updatePolicy(agent.key, { ...base, expectedVersion: '0' }, 'a')).toEqual({ ok: false, code: 'POLICY_CHANGED' });
    expect(await c.updatePolicy(agent.key, { ...base, expectedEpoch: '9' }, 'b')).toEqual({ ok: false, code: 'CONTROL_CHANGED' });
    c.setActor('B');
    expect(await c.updatePolicy(agent.key, base, 'c')).toEqual({ ok: false, code: 'NOT_CONTROLLER' });
  });

  it('a simulated transfer moves ownership, resets every setting, and locks out the old holder', async () => {
    const c = client();
    const agent = await firstOwned(c);
    const request = {
      expectedVersion: agent.policy.version,
      expectedEpoch: agent.control.epoch,
      active: true,
      focus: 'social' as const,
      homeStyle: 'treehouse' as const,
    };
    expect(await c.updatePolicy(agent.key, request, 'style')).toMatchObject({ ok: true });
    c.simulateTransfer(agent.key);
    expect((await c.getMyAgents()).some((a) => a.key === agent.key)).toBe(false);
    c.setActor('B');
    const now = (await c.getMyAgents()).find((a) => a.key === agent.key)!;
    expect(now.policy).toMatchObject({ active: false, focus: 'builder', homeStyle: 'cottage' });
    expect(now.plotId).toBe(agent.plotId);
    expect(BigInt(now.control.epoch)).toBe(BigInt(agent.control.epoch) + 1n);
  });

  it('streams committed events after a revision and stops on unsubscribe', async () => {
    const c = client();
    c.tick();
    const seen: CityEvent[] = [];
    const unsubscribe = c.subscribe('0', (e) => seen.push(e), () => {});
    expect(seen.map((e) => e.revision)).toEqual(['1']);
    c.tick();
    expect(seen.map((e) => e.revision)).toEqual(['1', '2']);
    unsubscribe();
    c.tick();
    expect(seen).toHaveLength(2);
    expect((await c.getSnapshot()).revision).toBe('3');
  });

  it('city_tick events carry the activities Cult reads; other events do not', async () => {
    const c = client();
    c.tick();
    const [tick] = (await c.getSnapshot()).recentEvents;
    expect(tick!.type).toBe('city_tick');
    expect(tick!.data.activities!.length).toBeGreaterThan(0);
    for (const a of tick!.data.activities!) expect(['visit', 'greet', 'gather', 'build', 'idle']).toContain(a.kind);

    const agent = await firstOwned(c);
    c.simulateTransfer(agent.key);
    const events = (await c.getSnapshot()).recentEvents;
    expect(events.at(-1)!.type).not.toBe('city_tick');
    expect(events.at(-1)!.data.activities).toBeUndefined();
  });
});
