// Small, strict helpers for the JSON-RPC values the live reader uses. Anything malformed is an RPC
// failure: the reader reports `unavailable`, never a guessed value.
import { Interface, getAddress, keccak256 } from "ethers";
import type { JsonRpc } from "./rpc.js";

export interface BlockRef {
  readonly number: bigint;
  readonly hash: string;
}

/** A provider answered with something that is not a valid value for the request. */
export class MalformedRpcResult extends Error {
  override readonly name = "MalformedRpcResult";
}

const HASH = /^0x[0-9a-f]{64}$/;
const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function quantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

export function parseQuantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !QUANTITY.test(value.toLowerCase())) throw new MalformedRpcResult(`${label} is not a hex quantity.`);
  return BigInt(value);
}

export function parseHash(value: unknown, label: string): string {
  const hash = typeof value === "string" ? value.toLowerCase() : "";
  if (!HASH.test(hash)) throw new MalformedRpcResult(`${label} is not a 32-byte hash.`);
  return hash;
}

export function parseAddress(value: unknown, label: string): string {
  const address = typeof value === "string" ? value.toLowerCase() : "";
  if (!ADDRESS.test(address)) throw new MalformedRpcResult(`${label} is not an address.`);
  return address;
}

export function parseHex(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(value)) throw new MalformedRpcResult(`${label} is not hex data.`);
  return value.toLowerCase();
}

/** A block header by number or tag; null when the node does not have that block. */
export async function getBlock(rpc: JsonRpc, block: bigint | "finalized" | "latest"): Promise<BlockRef | null> {
  const raw = await rpc.request("eth_getBlockByNumber", [typeof block === "bigint" ? quantity(block) : block, false]);
  if (raw === null) return null;
  if (typeof raw !== "object") throw new MalformedRpcResult("eth_getBlockByNumber returned something other than a block.");
  const header = raw as { number?: unknown; hash?: unknown };
  const ref = { number: parseQuantity(header.number, "Block number"), hash: parseHash(header.hash, "Block hash") };
  if (typeof block === "bigint" && ref.number !== block) throw new MalformedRpcResult(`eth_getBlockByNumber(${block}) returned block ${ref.number}.`);
  return ref;
}

export async function requireBlock(rpc: JsonRpc, block: bigint | "finalized" | "latest"): Promise<BlockRef> {
  const ref = await getBlock(rpc, block);
  if (!ref) throw new MalformedRpcResult(`The RPC node does not have block ${block}.`);
  return ref;
}

export function codeHash(code: string): string {
  return keccak256(code);
}

export function checksum(address: string): string {
  return getAddress(address);
}

/** The adapter functions and errors the reader and manifest check use (contracts/ChogAdapter.sol). */
export const ADAPTER = new Interface([
  "function awaken(uint256 tokenId, string agentURI) returns (uint256 agentId)",
  "function agentOf(uint256 tokenId) view returns (uint256)",
  "function bindingOf(uint256 agentId) view returns ((uint8 standard, address tokenContract, uint256 tokenId))",
  "function controllerOf(uint256 agentId) view returns (address)",
  "function collection() view returns (address)",
  "function identityRegistry() view returns (address)",
  "error UnknownAgent(uint256 agentId)",
  "error NotAwakened(uint256 tokenId)",
  "error AlreadyAwakened(uint256 tokenId)",
  "error NotTokenOwner(uint256 tokenId, address caller)",
]);

/** The Chog Genesis collection reads the holdings index uses. */
export const COLLECTION = new Interface([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)",
]);

/** Multicall3, deployed at the same address on Monad as on most EVM chains. */
export const MULTICALL3_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11";
export const MULTICALL3 = new Interface([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);
