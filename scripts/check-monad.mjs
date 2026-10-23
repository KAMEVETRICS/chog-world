import fs from "node:fs";
import { TESTNET_REGISTRY, testnetRpcUrls } from "./deployment-config.mjs";
import { inspectCollection } from "./collection-check.mjs";
import { openRpcWithFallback } from "./rpc.mjs";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
const testnet = process.argv.includes("--testnet");
const chainId = testnet ? 10143 : 143;
const registryAddress = testnet ? TESTNET_REGISTRY : "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const collectionAddress = testnet ? process.env.CHOG_COLLECTION_ADDRESS : "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763";
const rpcUrl = testnet
  ? process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz"
  : process.env.MONAD_MAINNET_RPC_URL || "https://rpc.monad.xyz";
let rpc;
let expired = false;

async function check() {
  rpc = await openRpcWithFallback(testnet ? testnetRpcUrls(rpcUrl) : [rpcUrl], { expectedChainId: chainId });
  const provider = rpc.provider;
  const block = await provider.getBlockNumber();
  const registryCode = await provider.getCode(registryAddress, block);
  if (registryCode === "0x") throw new Error("Identity registry code is missing.");
  const result = { readOnly: true, checkedAt: new Date().toISOString(), rpcHost: rpc.rpcHost, chainId, block, registry: registryAddress, registryCodeBytes: (registryCode.length - 2) / 2 };
  if (collectionAddress) {
    Object.assign(result, await inspectCollection(provider, collectionAddress, { blockTag: block, chainId }));
  } else if (testnet) {
    Object.assign(result, { collection: null, collectionPlan: "Deploy a labelled TestChog NFT before the adapter." });
  }
  if (expired) throw new Error("Public RPC check expired; no result was saved.");
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(`artifacts/monad-${testnet ? "testnet" : "mainnet"}-check.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

let timer;
try {
  await Promise.race([check(), new Promise((_resolve, reject) => { timer = setTimeout(() => { expired = true; rpc?.close(); reject(new Error("Public RPC check timed out; no transaction was sent.")); }, 45_000); })]);
} catch (error) { console.error(error.shortMessage ?? error.message); process.exitCode = 1; }
finally { clearTimeout(timer); rpc?.close(); }
