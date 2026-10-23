// The deployment manifest shared with City: which chain, registry, adapter and collection are trusted,
// and the adapter's deployment receipt and code. Field names follow the City plan's manifest
// (docs/superpowers/plans/2026-10-19-chog-city.md, Task 9). Cult verifies every field it uses against
// the chain at startup; `abiHash` and `creationCodeHash` are accepted but not checked here.
import type { ChainId } from "../shared/identity.js";
import { ADAPTER, codeHash, parseAddress, parseHash, parseHex, parseQuantity, requireBlock, type BlockRef } from "./evm.js";
import type { LiveDeployment } from "./liveChainReader.js";
import type { JsonRpc } from "./rpc.js";

export interface DeploymentManifest {
  readonly environment: string;
  readonly chainId: ChainId;
  readonly registry: string;
  readonly adapter: string;
  readonly collection: string;
  readonly activationBlock: string;
  readonly activationBlockHash: string;
  readonly receipts: { readonly adapterDeployment: string };
  readonly runtimeCodeHashes: { readonly adapter: string };
}

const KEYS = new Set(["environment", "chainId", "registry", "adapter", "collection", "activationBlock", "activationBlockHash", "receipts", "runtimeCodeHashes", "abiHash", "creationCodeHash"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,19})$/;

function field<T>(record: Record<string, unknown>, key: string, check: (value: unknown) => value is T, expected: string): T {
  const value = record[key];
  if (!check(value)) throw new Error(`Manifest ${key} must be ${expected}.`);
  return value;
}
const isString = (pattern: RegExp) => (value: unknown): value is string => typeof value === "string" && pattern.test(value);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Checks the manifest's shape. Unknown top-level fields are refused so a typo cannot pass unnoticed. */
export function parseManifest(json: unknown): DeploymentManifest {
  if (!isObject(json)) throw new Error("The manifest must be a JSON object.");
  const unknown = Object.keys(json).filter((key) => !KEYS.has(key));
  if (unknown.length) throw new Error(`Unknown manifest fields: ${unknown.join(", ")}.`);
  const chainId = json.chainId;
  if (chainId !== 143 && chainId !== 10143 && chainId !== 31337) throw new Error("Manifest chainId must be 143, 10143 or 31337.");
  const receipts = field(json, "receipts", isObject, "an object");
  const codeHashes = field(json, "runtimeCodeHashes", isObject, "an object");
  return {
    environment: field(json, "environment", isString(/^[a-z0-9][a-z0-9-]{0,63}$/), "a short lowercase name"),
    chainId,
    registry: field(json, "registry", isString(ADDRESS), "an address").toLowerCase(),
    adapter: field(json, "adapter", isString(ADDRESS), "an address").toLowerCase(),
    collection: field(json, "collection", isString(ADDRESS), "an address").toLowerCase(),
    activationBlock: field(json, "activationBlock", isString(DECIMAL), "a decimal block number string"),
    activationBlockHash: field(json, "activationBlockHash", isString(HASH), "a block hash").toLowerCase(),
    receipts: { adapterDeployment: field(receipts, "adapterDeployment", isString(HASH), "the adapter deployment transaction hash").toLowerCase() },
    runtimeCodeHashes: { adapter: field(codeHashes, "adapter", isString(HASH), "the keccak256 of the adapter's runtime code").toLowerCase() },
  };
}

/**
 * Builds a manifest from a root deployment record (`deployments/*-monad-mainnet.json` or
 * `*-monad-testnet.json`): the adapter's address and transaction from the record, the block hash and
 * runtime code hash from the chain. Verify the result with `verifyManifest` before sharing it.
 */
export async function manifestFromDeployment(rpc: JsonRpc, record: unknown, environment: string): Promise<DeploymentManifest> {
  const adapter = (record as { deployments?: { ChogAdapter?: Record<string, unknown> } } | null)?.deployments?.ChogAdapter;
  if (!adapter || adapter.status !== "confirmed") throw new Error("The record has no confirmed ChogAdapter deployment; prepared or pending records are not deployments.");
  const args = adapter.constructorArgs;
  if (!Array.isArray(args) || typeof args[0] !== "string" || typeof args[1] !== "string") throw new Error("The record does not list the adapter's collection and registry constructor arguments.");
  const receipt = await rpc.request("eth_getTransactionReceipt", [adapter.transactionHash]);
  if (!isObject(receipt)) throw new Error(`No receipt for ${String(adapter.transactionHash)} on this RPC.`);
  const blockHash = parseHash(receipt.blockHash, "Receipt block hash");
  const code = parseHex(await rpc.request("eth_getCode", [String(adapter.address).toLowerCase(), { blockHash, requireCanonical: true }]), "Adapter code");
  return parseManifest({
    environment, chainId: Number(parseQuantity(await rpc.request("eth_chainId", []), "eth_chainId")),
    registry: args[1], adapter: adapter.address, collection: args[0],
    activationBlock: parseQuantity(receipt.blockNumber, "Receipt block").toString(), activationBlockHash: blockHash,
    receipts: { adapterDeployment: adapter.transactionHash }, runtimeCodeHashes: { adapter: codeHash(code) },
  });
}

export interface VerifiedManifest {
  readonly manifest: DeploymentManifest;
  readonly deployment: LiveDeployment;
  /** The finalized block the checks read. */
  readonly verifiedAt: BlockRef;
}

/**
 * Read-only checks against the chain: chain ID, the activation block, the adapter's deployment receipt
 * (successful, at the activation block, creating the adapter), the adapter's runtime code hash, and the
 * collection and registry the adapter was built with. Any mismatch throws; nothing is sent.
 */
export async function verifyManifest(rpc: JsonRpc, manifest: DeploymentManifest): Promise<VerifiedManifest> {
  const fail = (message: string) => new Error(`Manifest check failed: ${message}`);
  const chainId = parseQuantity(await rpc.request("eth_chainId", []), "eth_chainId");
  if (chainId !== BigInt(manifest.chainId)) throw fail(`the RPC serves chain ${chainId}, the manifest is for chain ${manifest.chainId}.`);

  const activation = await requireBlock(rpc, BigInt(manifest.activationBlock));
  if (activation.hash !== manifest.activationBlockHash) throw fail(`block ${manifest.activationBlock} has hash ${activation.hash}, not ${manifest.activationBlockHash}.`);

  const receipt = await rpc.request("eth_getTransactionReceipt", [manifest.receipts.adapterDeployment]);
  if (!isObject(receipt)) throw fail(`no receipt for the adapter deployment ${manifest.receipts.adapterDeployment}.`);
  if (parseQuantity(receipt.status, "Receipt status") !== 1n) throw fail("the adapter deployment transaction failed.");
  if (receipt.contractAddress == null || parseAddress(receipt.contractAddress, "Receipt contract address") !== manifest.adapter) throw fail("the deployment receipt did not create the manifest's adapter.");
  if (parseQuantity(receipt.blockNumber, "Receipt block") !== activation.number || parseHash(receipt.blockHash, "Receipt block hash") !== activation.hash) {
    throw fail("the adapter was not deployed in the activation block.");
  }

  const at = await requireBlock(rpc, "finalized");
  const pinned = { blockHash: at.hash, requireCanonical: true };
  const code = parseHex(await rpc.request("eth_getCode", [manifest.adapter, pinned]), "Adapter code");
  if (code === "0x") throw fail("the adapter has no code.");
  if (codeHash(code) !== manifest.runtimeCodeHashes.adapter) throw fail(`the adapter's runtime code hash is ${codeHash(code)}, not the manifest's.`);
  for (const [label, address] of [["collection", manifest.collection], ["registry", manifest.registry]] as const) {
    if (parseHex(await rpc.request("eth_getCode", [address, pinned]), `${label} code`) === "0x") throw fail(`the ${label} has no code.`);
  }
  const read = async (name: "collection" | "identityRegistry") => {
    const raw = parseHex(await rpc.request("eth_call", [{ to: manifest.adapter, data: ADAPTER.encodeFunctionData(name), gas: "0x186a0" }, pinned]), `${name}()`);
    return parseAddress(ADAPTER.decodeFunctionResult(name, raw)[0], `${name}()`);
  };
  if (await read("collection") !== manifest.collection) throw fail("the adapter was built for a different collection.");
  if (await read("identityRegistry") !== manifest.registry) throw fail("the adapter was built for a different identity registry.");

  return {
    manifest,
    deployment: { chainId: manifest.chainId, registry: manifest.registry, adapter: manifest.adapter, collection: manifest.collection, activation },
    verifiedAt: at,
  };
}
