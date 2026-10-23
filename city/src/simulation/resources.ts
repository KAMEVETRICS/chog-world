// Production / reserve / consume / release. Every inventory change goes through a ledger line,
// and applying lines is the only way inventory moves, so the ledger always reconciles.
import {
  RESOURCES,
  type AgentKey,
  type Inventory,
  type LedgerEntry,
  type LedgerReason,
  type Resource,
  type ResourceAmounts,
} from '../shared/contracts';
import { RESOURCE_CAP } from '../shared/rules';

export function available(inventory: Inventory, resource: Resource): number {
  return inventory[resource].total - inventory[resource].reserved;
}

export function canAfford(inventory: Inventory, costs: ResourceAmounts): boolean {
  return RESOURCES.every((r) => available(inventory, r) >= costs[r]);
}

export function line(
  agentKey: AgentKey,
  causeId: string,
  resource: Resource,
  reason: LedgerReason,
  totalDelta: number,
  reservedDelta: number,
): LedgerEntry {
  return { agentKey, resource, totalDelta, reservedDelta, causeId, lineId: `${resource}:${reason}`, reason };
}

/** One line per non-zero cost, in canonical resource order. */
function recipeLines(
  agentKey: AgentKey,
  causeId: string,
  costs: ResourceAmounts,
  reason: 'build_reserve' | 'build_consume' | 'build_release',
): LedgerEntry[] {
  return RESOURCES.filter((r) => costs[r] > 0).map((r) => {
    const cost = costs[r];
    if (reason === 'build_reserve') return line(agentKey, causeId, r, reason, 0, cost);
    if (reason === 'build_consume') return line(agentKey, causeId, r, reason, -cost, -cost);
    return line(agentKey, causeId, r, reason, 0, -cost);
  });
}

export const reserveLines = (key: AgentKey, cause: string, costs: ResourceAmounts) =>
  recipeLines(key, cause, costs, 'build_reserve');
export const consumeLines = (key: AgentKey, cause: string, costs: ResourceAmounts) =>
  recipeLines(key, cause, costs, 'build_consume');
export const releaseLines = (key: AgentKey, cause: string, costs: ResourceAmounts) =>
  recipeLines(key, cause, costs, 'build_release');

export class InventoryInvariantError extends Error {}

/** Pure: returns a new inventory, or throws if any line would break 0 <= reserved <= total <= cap. */
export function applyLedger(inventory: Inventory, lines: readonly LedgerEntry[]): Inventory {
  const next: Inventory = {
    wood: { ...inventory.wood },
    stone: { ...inventory.stone },
    food: { ...inventory.food },
  };
  for (const entry of lines) {
    const target = next[entry.resource];
    target.total += entry.totalDelta;
    target.reserved += entry.reservedDelta;
    if (target.reserved < 0 || target.reserved > target.total || target.total > RESOURCE_CAP) {
      throw new InventoryInvariantError(
        `${entry.causeId}/${entry.lineId} breaks inventory invariant: total=${target.total} reserved=${target.reserved}`,
      );
    }
  }
  return next;
}
