// A scripted chain behind the JsonRpc interface: blocks with hashes, ERC-721 Transfer logs, and the
// adapter's bindingOf/controllerOf answered at any canonical block hash. Reorgs replace blocks from a
// height. Failures can be injected per request.
import { createHash } from "node:crypto";
import { AbiCoder, Interface } from "ethers";
import { ADAPTER, TRANSFER_TOPIC, ZERO_ADDRESS, quantity } from "../../src/chain/evm.js";
import { RpcError, type JsonRpc } from "../../src/chain/rpc.js";

export const COLLECTION = "0x00000000000000000000000000000000000c6091";
export const ADAPTER_ADDRESS = "0x00000000000000000000000000000000000c4a77";
export const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const NONEXISTENT = new Interface(["error ERC721NonexistentToken(uint256 tokenId)"]);
const word = (value: bigint | string) => AbiCoder.defaultAbiCoder().encode(["uint256"], [value]).slice(2);
const topic = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;

export interface Transfer { readonly tokenId: bigint; readonly from: string; readonly to: string }
interface Block {
  readonly number: bigint;
  readonly hash: string;
  readonly transfers: readonly Transfer[];
  /** Owners after this block (null: burned or never minted). */
  readonly owners: ReadonlyMap<bigint, string | null>;
  /** agentId → tokenId bound so far. */
  readonly bindings: ReadonlyMap<bigint, bigint>;
}

export type Interceptor = (method: string, params: readonly unknown[]) => Promise<unknown> | unknown | undefined;

export class FakeChain implements JsonRpc {
  readonly host = "fake.rpc";
  readonly calls: string[] = [];
  /** Max eth_getLogs range, like Monad's public RPC. */
  maxLogRange = 100n;
  /** Finalized trails the head by this many blocks. */
  finalizedLag = 0n;
  /** Runs before each request; returning anything but undefined answers it (or throw to fail it). */
  intercept: Interceptor | undefined;
  #blocks: Block[] = [];
  #salt = 0;

  constructor(genesisBlocks = 1) {
    for (let i = 0; i < genesisBlocks; i++) this.mine();
  }

  get head(): { number: bigint; hash: string } { const block = this.#blocks.at(-1)!; return { number: block.number, hash: block.hash }; }
  block(number: bigint): { number: bigint; hash: string } { const block = this.#blocks[Number(number)]!; return { number: block.number, hash: block.hash }; }

  /** Mines one block with these transfers and bindings (agentId → tokenId). */
  mine(transfers: readonly Transfer[] = [], bind: readonly [bigint, bigint][] = []): { number: bigint; hash: string } {
    const parent = this.#blocks.at(-1);
    const number = parent ? parent.number + 1n : 0n;
    const owners = new Map(parent?.owners ?? []);
    for (const transfer of transfers) owners.set(transfer.tokenId, transfer.to === ZERO_ADDRESS ? null : transfer.to);
    const bindings = new Map(parent?.bindings ?? []);
    for (const [agentId, tokenId] of bind) bindings.set(agentId, tokenId);
    const hash = `0x${createHash("sha256").update(`${parent?.hash ?? "genesis"}:${number}:${this.#salt}:${JSON.stringify(transfers, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`).digest("hex")}`;
    this.#blocks.push({ number, hash, transfers, owners, bindings });
    return { number, hash };
  }

  mineEmpty(count: number): void { for (let i = 0; i < count; i++) this.mine(); }

  /** Drops blocks from `height` on; the next mined blocks get different hashes. */
  reorgFrom(height: bigint): void {
    this.#blocks = this.#blocks.slice(0, Number(height));
    this.#salt += 1;
  }

  close(): void {}

  async request(method: string, params: readonly unknown[]): Promise<unknown> {
    this.calls.push(method);
    const intercepted = await this.intercept?.(method, params);
    if (intercepted !== undefined) return intercepted;
    switch (method) {
      case "eth_getBlockByNumber": {
        const tag = params[0] as string;
        const number = tag === "finalized" ? this.head.number - this.finalizedLag : tag === "latest" ? this.head.number : BigInt(tag);
        const block = this.#blocks[Number(number)];
        return block ? { number: quantity(block.number), hash: block.hash, parentHash: this.#blocks[Number(number) - 1]?.hash ?? `0x${"00".repeat(32)}` } : null;
      }
      case "eth_getLogs": {
        const filter = params[0] as { address: string; fromBlock: string; toBlock: string };
        const from = BigInt(filter.fromBlock);
        const to = BigInt(filter.toBlock);
        if (to - from + 1n > this.maxLogRange) throw new RpcError(`RPC ${this.host} eth_getLogs returned HTTP 413; not retried.`, "transport", method);
        return this.#blocks.filter((block) => block.number >= from && block.number <= to).flatMap((block) => block.transfers.map((transfer, index) => ({
          address: COLLECTION, topics: [TRANSFER_TOPIC, topic(transfer.from), topic(transfer.to), `0x${word(transfer.tokenId)}`],
          data: "0x", blockNumber: quantity(block.number), blockHash: block.hash, logIndex: quantity(BigInt(index)), transactionHash: `0x${word(block.number * 1000n + BigInt(index))}`, removed: false,
        })));
      }
      case "eth_call": {
        const [call, at] = params as [{ to: string; data: string }, { blockHash: string }];
        const block = this.#blocks.find((candidate) => candidate.hash === at.blockHash);
        if (!block) throw new RpcError(`RPC ${this.host} eth_call returned an error -32602: Block requested not found.`, "error_response", method, -32602);
        const parsed = ADAPTER.parseTransaction({ data: call.data })!;
        const agentId = parsed.args[0] as bigint;
        const tokenId = block.bindings.get(agentId);
        if (tokenId === undefined) throw new RpcError(`RPC ${this.host} eth_call reverted 3`, "reverted", method, 3, ADAPTER.encodeErrorResult("UnknownAgent", [agentId]));
        if (parsed.name === "bindingOf") return ADAPTER.encodeFunctionResult("bindingOf", [[0, COLLECTION, tokenId]]);
        const owner = block.owners.get(tokenId);
        if (!owner) throw new RpcError(`RPC ${this.host} eth_call reverted 3`, "reverted", method, 3, NONEXISTENT.encodeErrorResult("ERC721NonexistentToken", [tokenId]));
        return ADAPTER.encodeFunctionResult("controllerOf", [owner]);
      }
      default:
        throw new RpcError(`RPC ${this.host} ${method} is not scripted.`, "error_response", method, -32601);
    }
  }
}
