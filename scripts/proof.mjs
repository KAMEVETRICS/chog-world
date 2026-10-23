import fs from "node:fs";
import { formatEther, formatUnits, NonceManager, VoidSigner, Wallet } from "ethers";
import { deploymentConfig } from "./deployment-config.mjs";
import { openRpcWithFallback } from "./rpc.mjs";
import {
  checkProofTarget, LATER_STEP_GAS_CEILINGS, newProofRecord, parseProofArgs, prepareMint, proofAgentURI, runProof, verifyProofRecord,
} from "./proof-steps.mjs";

// Public deployment verified in artifacts/monad-testnet-deployment-verification.json.
const ADAPTER = "0x095FFc29B9b7384763aac703a627Bf8A2D6c7869";
const COLLECTION = "0x9C716801D68b5bDADF7979D37A382a72fDBa1ABE";
const OWNER = "0xd0361ECd9fbBa2078ee7936B13B9e32A02775945";
const VERIFICATION_PATH = "artifacts/monad-testnet-ownership-proof-verification.json";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
const config = deploymentConfig();
// monad-testnet.drpc.org intermittently rejects eth_blockNumber; try it last among public endpoints.
const rpcUrls = [...config.rpcUrls].sort((a, b) => Number(new URL(a).hostname === "monad-testnet.drpc.org") - Number(new URL(b).hostname === "monad-testnet.drpc.org"));
const rpcOptions = { expectedChainId: config.chainId, timeoutMs: 15_000 };
// Errors are printed without URL paths or query strings, which can carry RPC credentials.
const redact = (text) => String(text).replace(/https?:\/\/([^/\s"'?#]+)[^\s"')]*/g, "$1");

async function main() {
  const args = parseProofArgs(process.argv.slice(2));
  if (args.verify) return verify(args.verify);
  const tokenId = args.tokenId ?? BigInt(Date.now());
  const generatedRecipient = !args.recipient;
  const recipient = args.recipient ?? Wallet.createRandom().address;
  const cfg = { chainId: config.chainId, registry: config.registry, adapter: ADAPTER, collection: COLLECTION, owner: OWNER, recipient, tokenId, agentURI: proofAgentURI(tokenId) };

  let account;
  if (args.broadcast) {
    if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("Set DEPLOYER_PRIVATE_KEY locally in .env. Nothing was signed.");
    try { account = new Wallet(process.env.DEPLOYER_PRIVATE_KEY); } catch { throw new Error("DEPLOYER_PRIVATE_KEY is not a valid signing key. Nothing was signed."); }
    if (account.address !== OWNER) throw new Error(`The configured key is not the planned owner ${OWNER}. Nothing was signed.`);
  }
  console.log("Checking chain, adapter configuration, token availability, gas and funding (read-only)...");
  const rpc = await openRpcWithFallback(rpcUrls, {
    ...rpcOptions,
    preflight: async (provider) => {
      await checkProofTarget(provider, cfg);
      // The dry run prepares the mint with a VoidSigner, which cannot sign.
      const signer = args.broadcast ? new NonceManager(account.connect(provider)) : new VoidSigner(OWNER, provider);
      return { signer, ...await prepareMint(signer, provider, cfg) };
    },
  });
  try {
    const { signer, prepared, balance, maxFeePerGas, budgetGas, budgetWei } = rpc.preflight;
    if (!args.broadcast) {
      console.log(JSON.stringify({
        dryRun: true, signed: false, rpcHost: rpc.rpcHost, chainId: config.chainId, officialChogCollection: false,
        adapter: ADAPTER, collection: COLLECTION, registry: config.registry, owner: OWNER,
        recipient, recipientNote: generatedRecipient ? "Fresh random address; its key was not kept, so the test NFT stays there. Pass --recipient to use your own second wallet." : "Supplied by --recipient.",
        tokenId: tokenId.toString(), agentURI: cfg.agentURI,
        steps: [
          `TestChog.mint(${OWNER}, ${tokenId}) — estimated gas ${prepared.gasLimit}, nonce ${prepared.nonce}`,
          `ChogAdapter.awaken(${tokenId}, agentURI) — estimated after mint (budgeted ${LATER_STEP_GAS_CEILINGS.awaken} gas)`,
          "Read agentOf, bindingOf, controllerOf, registry ownerOf and agent-binding at the awaken block",
          `TestChog.transferFrom(${OWNER}, ${recipient}, ${tokenId}) — estimated after awaken (budgeted ${LATER_STEP_GAS_CEILINGS.transfer} gas)`,
          "At the transfer block: controllerOf = recipient; old owner's setAgentURI/setMetadata simulate as NotTokenOwner; new owner's simulate as allowed",
        ],
        funding: { balanceMON: formatEther(balance), maxFeePerGasGwei: formatUnits(maxFeePerGas, "gwei"), budgetGas: budgetGas.toString(), budgetMON: formatEther(budgetWei) },
        broadcastCommand: `node scripts/proof.mjs --broadcast --token-id ${tokenId} --recipient ${recipient}`,
      }, null, 2));
      console.log("Dry run complete. Nothing was signed or broadcast.");
      return;
    }
    const record = newProofRecord(cfg, rpc.rpcHost);
    const recordPath = `deployments/${Date.now()}-monad-testnet-ownership-proof.json`;
    fs.mkdirSync("deployments", { recursive: true });
    const persist = (current) => fs.writeFileSync(recordPath, JSON.stringify(current, null, 2));
    persist(record);
    console.log(`Using ${rpc.rpcHost}; recording public hashes in ${recordPath}`);
    const reported = {};
    try {
      await runProof({
        signer, cfg, record, preparedMint: prepared,
        persist: (current) => {
          persist(current);
          for (const [name, tx] of Object.entries(current.transactions)) {
            if (reported[name] !== tx.status) console.log(`${name} ${tx.status}: ${tx.transactionHash}${tx.blockNumber ? ` (block ${tx.blockNumber})` : ""}`);
            reported[name] = tx.status;
          }
        },
      });
    } catch (error) {
      record.status = "failed";
      record.error = redact(error.shortMessage ?? error.message);
      persist(record);
      throw new Error(`${record.error} Saved ${recordPath}. Reconcile its hashes before trying again; do not reuse token ${tokenId}.`);
    }
    console.log(JSON.stringify({ agentId: record.agentId, afterAwaken: record.checks.afterAwaken, afterTransfer: record.checks.afterTransfer }, null, 2));
    console.log(`PASS: controller moved to ${recipient}; the old owner is rejected. Saved ${recordPath}.`);
    console.log(`Verify read-only: node scripts/proof.mjs --verify ${recordPath}`);
  } finally { rpc.close(); }
}

async function verify(recordPath) {
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  if (record.kind !== "chog-awakening-ownership-proof") throw new Error(`${recordPath} is not an ownership proof record.`);
  // Connect only; a failed check must report its cause instead of silently trying another endpoint.
  const rpc = await openRpcWithFallback(rpcUrls, rpcOptions);
  try {
    const verified = await verifyProofRecord(rpc.provider, record, { chainId: config.chainId });
    const result = { ...verified, rpcHost: rpc.rpcHost, sourceRecord: recordPath, officialChogCollection: false };
    fs.mkdirSync("artifacts", { recursive: true });
    fs.writeFileSync(VERIFICATION_PATH, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    console.log(`Verified read-only; saved ${VERIFICATION_PATH}.`);
  } finally { rpc.close(); }
}

main().catch((error) => { console.error(redact(error.shortMessage ?? error.message)); process.exitCode = 1; });
