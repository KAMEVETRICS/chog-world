import { describe, expect, it } from 'vitest';
import { makeAgentKey, type AgentIdentity } from '../../src/shared/contracts';
import { uint256StringSchema, worldStateSchema } from '../../src/shared/schemas';
import { makeFixtureWorld } from '../../src/fixtures/residents';

const identity: AgentIdentity = {
  chainId: '10143',
  registry: '0x1111111111111111111111111111111111111111',
  adapter: '0x2222222222222222222222222222222222222222',
  collection: '0x3333333333333333333333333333333333333333',
  tokenId: '0',
  agentId: '0',
};

describe('uint256StringSchema', () => {
  it('accepts zero and the maximum', () => {
    expect(uint256StringSchema.parse('0')).toBe('0');
    const max = (2n ** 256n - 1n).toString();
    expect(uint256StringSchema.parse(max)).toBe(max);
  });

  it('rejects overflow, negatives and non-canonical forms', () => {
    expect(() => uint256StringSchema.parse((2n ** 256n).toString())).toThrow();
    expect(() => uint256StringSchema.parse('-1')).toThrow();
    expect(() => uint256StringSchema.parse('007')).toThrow();
    expect(() => uint256StringSchema.parse('1e3')).toThrow();
    expect(() => uint256StringSchema.parse('')).toThrow();
  });
});

describe('makeAgentKey', () => {
  it('distinguishes adapters for the same token', () => {
    const other = { ...identity, adapter: '0x4444444444444444444444444444444444444444' };
    expect(makeAgentKey(identity)).not.toBe(makeAgentKey(other));
  });

  it('is insensitive to address casing', () => {
    const lower = { ...identity, adapter: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' };
    const mixed = { ...identity, adapter: '0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd' };
    expect(makeAgentKey(mixed)).toBe(makeAgentKey(lower));
  });

  it('rejects an invalid token id', () => {
    expect(() => makeAgentKey({ ...identity, tokenId: '-1' })).toThrow();
  });
});

describe('fixture world', () => {
  it('has 8 residents on 12 unique plots, starting at token zero', () => {
    const world = makeFixtureWorld();
    expect(world.agents).toHaveLength(8);
    expect(world.plots).toHaveLength(12);
    expect(new Set(world.plots.map((p) => p.id)).size).toBe(12);
    expect(new Set(world.plots.map((p) => `${p.x},${p.y}`)).size).toBe(12);
    expect(new Set(world.agents.map((a) => a.plotId)).size).toBe(8);
    expect(world.agents[0]!.identity.tokenId).toBe('0');
    expect(world.agents[0]!.identity.agentId).toBe('0');
    expect(() => worldStateSchema.parse(world)).not.toThrow();
  });

  it('alternates fixture controllers A and B', () => {
    const world = makeFixtureWorld();
    const controllers = world.agents.map((a) => a.control.controller);
    expect(controllers[0]).not.toBe(controllers[1]);
    expect(controllers[0]).toBe(controllers[2]);
  });

  it('respects residentCount and active options', () => {
    const world = makeFixtureWorld({ residentCount: 1, active: false });
    expect(world.agents).toHaveLength(1);
    expect(world.agents[0]!.policy.active).toBe(false);
  });
});
