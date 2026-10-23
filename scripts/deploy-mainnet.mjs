// Monad mainnet ChogAdapter deployment. Modes:
//   (no flags)                  offline plan, no RPC and no key
//   --preflight                 live unsigned checks; prints the confirmation code
//   --broadcast --confirm CODE  signs and sends one transaction, only if CODE still matches
//   --check ADDRESS             read-only verification of a deployed adapter
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { ContractFactory, VoidSigner, Wallet, formatEther, getAddress } from "ethers";
import { loadArtifact } from "./artifacts.mjs";
import { deployAndRecord } from "./deploy-contract.mjs";
import { adapterConstructorArgs, checkMainnetDependencies, mainnetConfig, mainnetPlan, prepareMainnetAdapter, verifyDeployedAdapter } from "./mainnet.mjs";
import { openRpc } from "./rpc.mjs";

export function parseArgs(argv) {
  const value = (flag) => { const index = argv.indexOf(flag); return index === -1 ? undefined : argv[index + 1]; };
  const modes = ["--preflight", "--broadcast", "--check"].filter((flag) => argv.includes(flag));
  if (modes.length > 1) throw new Error("Choose one of --preflight, --broadcast or --check.");
  const mode = modes[0]?.slice(2) ?? "plan";
  const confirm = value("--confirm");
  if (mode === "broadcast" && !/^CHOG-[0-9A-F]{8}$/.test(confirm ?? "")) throw new Error("--broadcast requires --confirm CHOG-XXXXXXXX from a fresh --preflight run.");
  if (mode !== "broadcast" && confirm !== undefined) throw new Error("--confirm is only used with --broadcast.");
  const check = value("--check");
  if (mode === "check") {
    try { return { mode, address: getAddress(check) }; } catch { throw new Error("--check requires the adapter address."); }
  }
  return { mode, confirm };
}

/// The mainnet signer is separate from the testnet key, and must never be the same wallet.
export function mainnetSigner(env, { needKey }) {
  const key = env.MAINNET_DEPLOYER_PRIVATE_KEY;
  if (!key) {
    if (needKey) throw new Error("Set MAINNET_DEPLOYER_PRIVATE_KEY locally in .env to broadcast. No transaction was sent.");
    if (!env.MAINNET_DEPLOYER_ADDRESS) throw new Error("Set MAINNET_DEPLOYER_ADDRESS (or the mainnet key) so preflight can check nonce and funding.");
    return { address: getAddress(env.MAINNET_DEPLOYER_ADDRESS), wallet: null };
  }
  let wallet;
  try { wallet = new Wallet(key); } catch { throw new Error("MAINNET_DEPLOYER_PRIVATE_KEY is not a valid signing key."); }
  if (env.DEPLOYER_PRIVATE_KEY) {
    let testnet = null;
    try { testnet = new Wallet(env.DEPLOYER_PRIVATE_KEY).address; } catch {}
    if (testnet === wallet.address) throw new Error("The mainnet deployer must not reuse the testnet DEPLOYER_PRIVATE_KEY wallet.");
  }
  if (env.MAINNET_DEPLOYER_ADDRESS && getAddress(env.MAINNET_DEPLOYER_ADDRESS) !== wallet.address) {
    throw new Error("MAINNET_DEPLOYER_ADDRESS does not match MAINNET_DEPLOYER_PRIVATE_KEY.");
  }
  return { address: wallet.address, wallet };
}

const formatMon = (wei) => `${formatEther(wei)} MON`;

async function main() {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const args = parseArgs(process.argv.slice(2));
  const config = mainnetConfig();
  if (args.mode === "plan") { console.log(JSON.stringify(mainnetPlan(config), null, 2)); return; }
  const rpc = await openRpc(config.rpcUrl, { expectedChainId: config.chainId });
  try {
    const provider = rpc.provider;
    const host = new URL(config.rpcUrl).hostname;
    if (args.mode === "check") {
      console.log(JSON.stringify(await verifyDeployedAdapter(provider, args.address, { config }), (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
      return;
    }
    const { address, wallet } = mainnetSigner(process.env, { needKey: args.mode === "broadcast" });
    console.log(`Checking Monad mainnet dependencies through ${host} before signing...`);
    const dependencies = await checkMainnetDependencies(provider, config);
    const signer = wallet ? wallet.connect(provider) : new VoidSigner(address, provider);
    const plan = await prepareMainnetAdapter(provider, signer, config);
    const summary = {
      network: "Monad mainnet (143)", rpcHost: host, deployer: plan.deployer, nonce: plan.nonce,
      collection: config.genesis, identityRegistry: config.identityRegistry, registryImplementation: dependencies.registryImplementation,
      tokenbound: config.tokenbound, gasLimit: plan.gasLimit.toString(), maxFeePerGas: plan.maxFeePerGas.toString(),
      maxCost: formatMon(plan.maxCost), balance: formatMon(plan.balance), initCodeHash: plan.initCodeHash,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (args.mode === "preflight") {
      console.log(`Preflight passed. Confirmation code: ${plan.confirmation}`);
      console.log(`To deploy, run: npm.cmd run deploy:mainnet -- --broadcast --confirm ${plan.confirmation}`);
      console.log("Nothing was signed or broadcast.");
      return;
    }
    if (args.confirm !== plan.confirmation) {
      throw new Error(`Confirmation code ${args.confirm} does not match the current deployment (${plan.confirmation}). The nonce, deployer or code changed since preflight; rerun --preflight. No transaction was sent.`);
    }
    const record = { network: "monad-mainnet", chainId: config.chainId, confirmation: plan.confirmation, preflight: summary, deployments: {} };
    const recordPath = `deployments/${Date.now()}-monad-mainnet.json`;
    fs.mkdirSync("deployments", { recursive: true });
    const save = () => fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
    const artifact = loadArtifact("ChogAdapter");
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const constructorArgs = adapterConstructorArgs(config);
    const deployed = await deployAndRecord(factory, constructorArgs, (deployment) => {
      console.log(`ChogAdapter ${deployment.status}: ${deployment.transactionHash}; address ${deployment.address}`);
      record.deployments.ChogAdapter = { ...deployment, constructorArgs };
      save();
    }, { prepared: plan.prepared });
    record.verification = await verifyDeployedAdapter(provider, deployed.address, { expectedRuntime: plan.expectedRuntime, config });
    save();
    console.log(`Adapter deployed and verified at ${deployed.address}; saved ${recordPath}`);
    console.log(`Publish its source with: npm.cmd run verify:mainnet -- --record ${recordPath}`);
  } finally { rpc.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.shortMessage ?? error.message); process.exitCode = 1; });
}
