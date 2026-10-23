import { Contract, getAddress, keccak256, ZeroAddress } from "ethers";
import { loadArtifact } from "./artifacts.mjs";

export const TESTNET_CHAIN_ID = 10143;
export const TESTNET_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
// Canonical Tokenbound deployment (same addresses on Monad testnet and mainnet). The SDK derives
// accounts from AccountProxy with salt zero; the adapter must match so tokenAccountOf agrees with it.
export const TOKENBOUND = {
  registry: "0x000000006551c19487814612e58FE06813775758",
  implementation: "0x55266d75D1a14E4572138116aF39863Ed6596E7F",
  salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
};
const PUBLIC_TESTNET_RPCS = ["https://monad-testnet.drpc.org", "https://rpc.ankr.com/monad_testnet", "https://testnet-rpc.monad.xyz"];

export function testnetRpcUrls(primary) {
  const normalized = primary.replace(/\/$/, "");
  // Custom/private endpoints remain exclusive; never copy their credentials to another host.
  return PUBLIC_TESTNET_RPCS.includes(normalized) ? [primary, ...PUBLIC_TESTNET_RPCS.filter((url) => url !== normalized)] : [primary];
}

export function deploymentConfig(env = process.env) {
  let collection = null;
  if (env.CHOG_COLLECTION_ADDRESS) {
    try { collection = getAddress(env.CHOG_COLLECTION_ADDRESS); }
    catch { throw new Error("CHOG_COLLECTION_ADDRESS must be a valid collection address."); }
    if (collection === ZeroAddress) throw new Error("The collection address cannot be zero.");
  }
  const rpcUrl = env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
  let parsed;
  try { parsed = new URL(rpcUrl); } catch { throw new Error("MONAD_TESTNET_RPC_URL must be an HTTP(S) URL."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("MONAD_TESTNET_RPC_URL must use HTTP(S).");
  return { chainId: TESTNET_CHAIN_ID, registry: TESTNET_REGISTRY, collection, rpcUrl, rpcUrls: testnetRpcUrls(rpcUrl) };
}

export function deploymentPlan(config) {
  const adapter = loadArtifact("ChogAdapter");
  return {
    chainId: config.chainId,
    registry: config.registry,
    collection: config.collection,
    officialChogCollection: false,
    broadcast: false,
    compiler: adapter.compiler,
    adapterCreationCodeHash: keccak256(adapter.bytecode),
    actions: [
      ...(!config.collection ? [{ contract: "TestChog", purpose: "Clearly labelled test NFT; not official Chog Genesis" }] : []),
      { contract: "ChogAdapter", constructor: { collection: config.collection ?? "address of newly deployed TestChog", identityRegistry: config.registry, accountRegistry: TOKENBOUND.registry, accountImplementation: TOKENBOUND.implementation, accountSalt: TOKENBOUND.salt } },
    ],
    next: "Broadcast only after a funded testnet signer is configured; preflight will check chain, registry, collection and balance.",
  };
}

export async function validateNetwork(provider, config) {
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(TESTNET_CHAIN_ID)) throw new Error(`Deployment requires Monad testnet chain ${TESTNET_CHAIN_ID}; received ${network.chainId}.`);
  if (await provider.getCode(config.registry) === "0x") throw new Error("The canonical identity registry has no code on this network.");
  const erc721ABI = ["function supportsInterface(bytes4) view returns (bool)"];
  // Some public RPCs reject eth_call's default gas allowance; bound these reads explicitly.
  const callOptions = { gasLimit: 100_000n };
  const registry = new Contract(config.registry, erc721ABI, provider);
  if (!await registry.supportsInterface("0x80ac58cd", callOptions)) throw new Error("The identity registry does not support ERC-721.");
  for (const address of [TOKENBOUND.registry, TOKENBOUND.implementation]) {
    if (await provider.getCode(address) === "0x") throw new Error(`The Tokenbound contract ${address} has no code on this network.`);
  }
  if (config.collection) {
    if (await provider.getCode(config.collection) === "0x") throw new Error("The selected collection has no code on testnet.");
    const collection = new Contract(config.collection, erc721ABI, provider);
    if (!await collection.supportsInterface("0x80ac58cd", callOptions)) throw new Error("The selected collection does not support ERC-721.");
  }
}
