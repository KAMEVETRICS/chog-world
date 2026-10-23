import fs from "node:fs";
import { ContractFactory, NonceManager, Wallet } from "ethers";
import { loadArtifact } from "./artifacts.mjs";
import { TOKENBOUND, deploymentConfig, deploymentPlan, validateNetwork } from "./deployment-config.mjs";
import { deployAndRecord, prepareDeployment } from "./deploy-contract.mjs";
import { openRpcWithFallback } from "./rpc.mjs";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
const broadcast = process.argv.includes("--broadcast");
const preflightOnly = process.argv.includes("--preflight");
const config = deploymentConfig();

async function main() {
  const plan = deploymentPlan(config);
  if (!broadcast && !preflightOnly) { console.log(JSON.stringify(plan, null, 2)); return; }
  if (broadcast && preflightOnly) throw new Error("Choose --preflight or --broadcast, not both.");
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) throw new Error("Set DEPLOYER_PRIVATE_KEY locally in .env for a funded testnet wallet. No transaction was sent.");
  let account;
  try { account = new Wallet(privateKey); }
  catch { throw new Error("DEPLOYER_PRIVATE_KEY is not a valid signing key."); }
  const firstName = config.collection ? "ChogAdapter" : "TestChog";
  const adapterArgs = (collection) => [collection, config.registry, TOKENBOUND.registry, TOKENBOUND.implementation, TOKENBOUND.salt];
  const firstArgs = config.collection ? adapterArgs(config.collection) : [];
  const firstArtifact = loadArtifact(firstName);
  console.log("Checking network, funding, gas estimate, nonce and fees before signing...");
  const rpc = await openRpcWithFallback(config.rpcUrls, {
    expectedChainId: config.chainId,
    preflight: async (provider) => {
      await validateNetwork(provider, config);
      const wallet = account.connect(provider);
      const balance = await provider.getBalance(wallet.address);
      const signer = new NonceManager(wallet);
      const reject = (message) => { throw Object.assign(new Error(message), { code: "PREFLIGHT_REJECTED" }); };
      if (balance === 0n) reject("The selected testnet wallet needs test MON. No transaction was sent.");
      const factory = new ContractFactory(firstArtifact.abi, firstArtifact.bytecode, signer);
      const prepared = await prepareDeployment(factory, firstArgs);
      const maxFee = prepared.maxFeePerGas ?? prepared.gasPrice;
      if (balance < prepared.gasLimit * maxFee) reject("The selected wallet needs more test MON for the estimated deployment fee. No transaction was sent.");
      return { wallet, signer, prepared };
    },
  });
  try {
    const { wallet, signer, prepared } = rpc.preflight;
    console.log(`Deployment preflight passed using ${rpc.rpcHost}; ${firstName} estimated gas: ${prepared.gasLimit}.`);
    if (preflightOnly) { console.log("Read-only preflight complete. No transaction was signed or broadcast."); return; }
    const record = { chainId: config.chainId, registry: config.registry, deployer: wallet.address, officialChogCollection: false, deployments: {} };
    const recordPath = `deployments/${Date.now()}-monad-testnet.json`;
    fs.mkdirSync("deployments", { recursive: true });
    const save = () => fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
    let firstPrepared = prepared;
    const deploy = async (name, args = []) => {
      const artifact = loadArtifact(name);
      const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
      const options = firstPrepared ? { prepared: firstPrepared } : {};
      firstPrepared = null;
      return deployAndRecord(factory, args, (deployment) => {
        console.log(`${name} ${deployment.status}: ${deployment.transactionHash}; predicted address ${deployment.address}`);
        record.deployments[name] = { ...deployment, constructorArgs: args };
        save();
      }, options);
    };
    let collection = config.collection;
    if (!collection) {
      await deploy("TestChog");
      collection = record.deployments.TestChog.address;
      save();
      console.log(`Test NFT deployed at ${collection}; saved ${recordPath}`);
    }
    record.collection = collection;
    await deploy("ChogAdapter", adapterArgs(collection));
    save();
    console.log(`Adapter deployed at ${record.deployments.ChogAdapter.address}; saved ${recordPath}`);
  } finally { rpc.close(); }
}

main().catch((error) => { console.error(error.shortMessage ?? error.message); process.exitCode = 1; });
