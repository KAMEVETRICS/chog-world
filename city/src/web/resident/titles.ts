// Milestones a Chog earns as it settles in, and the title it goes by. Read from what lasts in the world
// (home level, a full garden), so a title is never lost and needs nothing stored beyond the world itself.
import type { AgentState } from '../../shared/contracts';
import { DECOR_IDS } from '../../shared/contracts';
import { MAX_DECOR } from '../../shared/rules';

export interface Milestone {
  id: string;
  title: string;
  /** What earns it, in a few words. */
  needs: string;
  earned: (agent: AgentState) => boolean;
  /** Home milestones form the ladder a Chog's title comes from. */
  ladder: boolean;
}

const homeAt = (level: number) => (agent: AgentState) => agent.homeLevel >= level;

export const MILESTONES: readonly Milestone[] = [
  { id: 'settler', title: 'Settler', needs: 'Build a first home', earned: homeAt(1), ladder: true },
  { id: 'homeowner', title: 'Homeowner', needs: 'Reach home level 2', earned: homeAt(2), ladder: true },
  { id: 'craftsman', title: 'Craftsman', needs: 'Reach home level 3', earned: homeAt(3), ladder: true },
  { id: 'landowner', title: 'Landowner', needs: 'Reach home level 4', earned: homeAt(4), ladder: true },
  { id: 'master', title: 'Master Builder', needs: 'Reach home level 5', earned: homeAt(5), ladder: true },
  {
    id: 'gardener',
    title: 'Gardener',
    needs: `Fill the garden (${Math.min(MAX_DECOR, DECOR_IDS.length)} decorations)`,
    earned: (agent) => agent.decor.length >= Math.min(MAX_DECOR, DECOR_IDS.length),
    ladder: false,
  },
];

/** The highest home title earned, or "Newcomer" before the first home. */
export function titleOf(agent: AgentState): string {
  return [...MILESTONES].reverse().find((m) => m.ladder && m.earned(agent))?.title ?? 'Newcomer';
}

/** Titles earned that `before` hadn't, for the recap. */
export function newlyEarned(before: Pick<AgentState, 'homeLevel' | 'decor'>, now: AgentState): Milestone[] {
  return MILESTONES.filter((m) => m.earned(now) && !m.earned({ ...now, homeLevel: before.homeLevel, decor: before.decor }));
}
