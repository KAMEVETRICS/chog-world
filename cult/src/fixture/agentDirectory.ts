import type { AgentDirectory, AgentLookup } from "../chain/agentDirectory.js";
import type { FixtureChog } from "./chogs.js";

/** Local fixture only: the fixture Chogs are the awakened ones; any other token is not awakened. */
export class FixtureAgentDirectory implements AgentDirectory {
  readonly #chogs: readonly FixtureChog[];

  constructor(chogs: readonly FixtureChog[]) {
    this.#chogs = chogs;
  }

  async lookup(tokenId: string): Promise<AgentLookup> {
    const chog = this.#chogs.find((entry) => entry.identity.tokenId === tokenId);
    return chog ? { kind: "awakened", identity: chog.identity, name: chog.name, traits: chog.traits } : { kind: "not_awakened" };
  }
}
