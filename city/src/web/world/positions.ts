// Who stands where. Shared by the 3D world and the 2D fallback map so they always agree:
// residents at the same location get stable, key-ordered slots.
import type { AgentState, Location, WorldState } from '../../shared/contracts';

export interface Standing {
  agent: AgentState;
  location: Location;
  /** 0-based slot among residents at the same location, ordered by agent key. */
  slot: number;
}

export function standings(world: WorldState): Map<string, Standing> {
  const groups = new Map<string, AgentState[]>();
  for (const agent of world.agents) {
    if (agent.control.kind === 'burned') continue; // ruins have no resident walking around
    const id = agent.location.kind === 'plot' ? `plot:${agent.location.plotId}` : `place:${agent.location.placeId}`;
    groups.set(id, [...(groups.get(id) ?? []), agent]);
  }
  const result = new Map<string, Standing>();
  for (const members of groups.values()) {
    members.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    members.forEach((agent, slot) => result.set(agent.key, { agent, location: agent.location, slot }));
  }
  return result;
}
