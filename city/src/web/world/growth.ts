// What of the town actually exists on the ground: every plot and lot someone lives on, plus the next few free
// ones in fill order (the order the server hands them out), marked for settlers. Land further down the list
// isn't drawn at all, so the town starts small and grows street by street, district by district.
import type { WorldState } from '../../shared/contracts';

/** Free plots and lots kept open at the edge of town, ready for the next arrivals. */
export const SPARE_PLOTS = 2;
export const SPARE_LOTS = 3;

export interface Built {
  plots: ReadonlySet<string>;
  lots: ReadonlySet<string>;
}

function shown(all: readonly { id: string }[], taken: ReadonlySet<string>, spare: number): Set<string> {
  const out = new Set<string>();
  let free = 0;
  for (const { id } of all) {
    if (taken.has(id)) out.add(id);
    else if (free < spare) {
      out.add(id);
      free += 1;
    }
  }
  return out;
}

export function builtUp(world: Pick<WorldState, 'plots' | 'lots' | 'agents' | 'citizens'>): Built {
  return {
    plots: shown(world.plots, new Set(world.agents.map((a) => a.plotId)), SPARE_PLOTS),
    lots: shown(world.lots, new Set(world.citizens.map((c) => c.lotId)), SPARE_LOTS),
  };
}
