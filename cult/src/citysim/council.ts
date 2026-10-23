// Runs Chog City's morning council on the server. Each active Chog's turn comes from its AI when its holder
// opted in and has credits (paid through Chog Soul), and otherwise from City's rules-based mind. Turns are
// decided outside any lock, then applied together and paid for in one transaction: AI turns that changed
// nothing are refunded.
import type { SoulService, AiResult } from "../soul/service.js";
import type { PgCity } from "./pgCity.js";
import { councilMembers, councilPrompt, parseCouncilReply, type CouncilSeat, type CouncilTurn } from "./world.js";

const CONCURRENCY = 4;

export class CityCouncil {
  readonly #city: PgCity;
  readonly #soul: SoulService | null;
  #running = false;

  constructor(city: PgCity, soul: SoulService | null) {
    this.#city = city;
    this.#soul = soul;
  }

  /** Holds the council if one is due. Safe to call every scheduler tick; overlapping calls do nothing. */
  async runIfDue(): Promise<{ tick: string; spoke: number; ai: number } | null> {
    if (this.#running) return null;
    this.#running = true;
    try {
      const plan = await this.#city.councilPlan();
      if (!plan) return null;
      const members = councilMembers(plan.world);
      const seats: CouncilSeat[] = [];
      const paid = new Map<string, AiResult<Omit<CouncilTurn, "by">>>();
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, members.length) }, async () => {
        while (next < members.length) {
          const agent = members[next++]!;
          const instructions = plan.instructions.get(agent.key) ?? null;
          const ai = this.#soul
            ? await this.#soul.council(agent.key, plan.tick, (voice) => councilPrompt(plan.world, agent, voice, instructions), parseCouncilReply)
            : null;
          if (ai) paid.set(agent.key, ai);
          // Without AI the rules-based mind decides inside the session, against the world as it stands then.
          seats.push(ai ? { agentKey: agent.key, instructions, turn: { ...ai.value, by: "ai" } as CouncilTurn } : { agentKey: agent.key, instructions });
        }
      }));
      // The session seats Chogs in agent-key order, so its result doesn't depend on which model answered first.
      const used = await this.#city.applyCouncil(plan.tick, seats, async (db, changed) => {
        if (this.#soul && paid.size) await this.#soul.settle(db, paid.values(), (result) => [...paid].some(([key, r]) => r === result && changed.has(key)));
      });
      if (used === null) {
        // Another process held this session first.
        if (this.#soul && paid.size) await this.#soul.release(paid.values());
        return null;
      }
      return { tick: plan.tick, spoke: used.size, ai: paid.size };
    } finally {
      this.#running = false;
    }
  }
}
