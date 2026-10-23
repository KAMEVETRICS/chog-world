import type { AgentIdentity, ChainReader, ControlObservation } from "../shared/identity.js";
import type { FixtureChog } from "./chogs.js";

interface TokenState {
  owner: string | null;
  epoch: number;
  unavailable: boolean;
}

const tokenKey = (identity: AgentIdentity) => `${identity.chainId}:${identity.collection.toLowerCase()}:${identity.tokenId}`;

/**
 * Local fixture ownership. Every transfer advances the ownership epoch, including a transfer back to an
 * earlier owner, matching the City design. Nothing here talks to a chain.
 */
export class FixtureChainReader implements ChainReader {
  readonly #tokens = new Map<string, TokenState>();
  #block = 1;

  constructor(chogs: readonly FixtureChog[]) {
    for (const chog of chogs) this.#tokens.set(tokenKey(chog.identity), { owner: chog.owner.toLowerCase(), epoch: 1, unavailable: false });
  }

  #token(identity: AgentIdentity): TokenState {
    const token = this.#tokens.get(tokenKey(identity));
    if (!token) throw new Error(`Fixture token ${identity.tokenId} does not exist.`);
    return token;
  }

  transfer(identity: AgentIdentity, to: string): void {
    const token = this.#token(identity);
    if (token.owner === null) throw new Error("A burned fixture token cannot be transferred.");
    token.owner = to.toLowerCase();
    token.epoch += 1;
    this.#block += 1;
  }

  burn(identity: AgentIdentity): void {
    const token = this.#token(identity);
    token.owner = null;
    token.epoch += 1;
    this.#block += 1;
  }

  /** Simulates an RPC outage for one token: reads report `unavailable` without changing ownership. */
  setUnavailable(identity: AgentIdentity, unavailable: boolean): void {
    this.#token(identity).unavailable = unavailable;
  }

  async resolveAgent(identity: AgentIdentity): Promise<ControlObservation> {
    const token = this.#token(identity);
    if (token.unavailable) return { kind: "unavailable", reason: "rpc" };
    const evidence = {
      ownershipEpoch: String(token.epoch), blockNumber: String(this.#block),
      blockHash: `0x${this.#block.toString(16).padStart(64, "0")}`, observedAtMs: this.#block, projectionGeneration: "1",
    };
    return token.owner === null ? { kind: "burned", ...evidence } : { kind: "controlled", controller: token.owner, ...evidence };
  }
}
