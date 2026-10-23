// Start / progress / cancel / finish a home build. Reserve on start, consume on completion,
// release once on cancel. Each returns ledger lines; callers apply them with applyLedger.
import type { AgentState, Construction, LedgerEntry, PublicChange, Uint256 } from '../shared/contracts';
import { MAX_HOME_LEVEL, recipeForLevel } from '../shared/rules';
import { consumeLines, releaseLines, reserveLines } from './resources';

export function nextRecipe(agent: AgentState) {
  return agent.homeLevel >= MAX_HOME_LEVEL ? undefined : recipeForLevel(agent.homeLevel + 1);
}

export function startConstruction(agent: AgentState, tick: Uint256, causeId: string) {
  const recipe = nextRecipe(agent);
  if (!recipe) throw new Error(`${agent.key} has no further home level`);
  const construction: Construction = {
    actionId: causeId,
    targetLevel: recipe.level,
    costs: { ...recipe.costs },
    remainingTicks: recipe.buildTicks,
    policyVersion: agent.policy.version,
    ownershipEpoch: agent.control.epoch,
    startedTick: tick,
  };
  const ledger = reserveLines(agent.key, causeId, recipe.costs);
  const changes: PublicChange[] = [
    { type: 'build_started', agentKey: agent.key, targetLevel: recipe.level, actionId: causeId },
  ];
  return { construction, ledger, changes };
}

/** One eligible tick of work. Completion consumes the reservation made at start. */
export function progressConstruction(agent: AgentState, construction: Construction, causeId: string) {
  const remainingTicks = construction.remainingTicks - 1;
  if (remainingTicks > 0) {
    return {
      construction: { ...construction, remainingTicks },
      completed: false,
      ledger: [] as LedgerEntry[],
      changes: [{ type: 'build_progressed', agentKey: agent.key, remainingTicks }] as PublicChange[],
    };
  }
  return {
    construction: null,
    completed: true,
    ledger: consumeLines(agent.key, causeId, construction.costs),
    changes: [
      { type: 'build_completed', agentKey: agent.key, level: construction.targetLevel, homeStyle: agent.policy.homeStyle },
    ] as PublicChange[],
  };
}

export function cancelConstruction(agent: AgentState, causeId: string, cause: 'policy' | 'control') {
  if (!agent.construction) return { ledger: [] as LedgerEntry[], changes: [] as PublicChange[] };
  return {
    ledger: releaseLines(agent.key, causeId, agent.construction.costs),
    changes: [
      { type: 'build_cancelled', agentKey: agent.key, actionId: agent.construction.actionId, cause },
    ] as PublicChange[],
  };
}
