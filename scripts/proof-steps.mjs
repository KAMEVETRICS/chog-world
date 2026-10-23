import { Contract, getAddress, Interface, toUtf8Bytes, encodeBase64, ZeroAddress } from "ethers";
import { loadArtifact } from "./artifacts.mjs";
import { prepareTransaction, sendAndRecord } from "./deploy-contract.mjs";

// Awakening and transfer can only be estimated after the earlier steps exist on chain,
// so the budget check uses these ceilings (each above the local measured gas).
export const LATER_STEP_GAS_CEILINGS = { awaken: 1_500_000n, transfer: 200_000n };
// Some public RPCs reject eth_call's default gas allowance; bound every read explicitly.
const READ = { gasLimit: 500_000n };
const STEPS = ["mint", "awaken", "transfer"];

function reject(message) {
  throw Object.assign(new Error(message), { code: "PREFLIGHT_REJECTED" });
}

function expect(condition, message) {
  if (!condition) throw Object.assign(new Error(`Proof check failed: ${message}`), { code: "PROOF_CHECK_FAILED" });
}

export function proofContracts(cfg, runner) {
  return {
    adapter: new Contract(cfg.adapter, loadArtifact("ChogAdapter").abi, runner),
    collection: new Contract(cfg.collection, loadArtifact("TestChog").abi, runner),
    registry: new Contract(cfg.registry, loadArtifact("IdentityRegistryUpgradeable").abi, runner),
  };
}

export function proofAgentURI(tokenId) {
  const registration = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `Chog Awakening testnet proof #${tokenId}`,
    description: "Test-only identity bound to a TestChog fixture NFT through ChogAdapter. Not an official Chog.",
  };
  return `data:application/json;base64,${encodeBase64(toUtf8Bytes(JSON.stringify(registration)))}`;
}

export function parseProofArgs(argv) {
  const args = { broadcast: false, verify: null, tokenId: null, recipient: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`${flag} needs a value.`);
      return argv[++i];
    };
    if (flag === "--broadcast") args.broadcast = true;
    else if (flag === "--verify") args.verify = value();
    else if (flag === "--token-id") {
      const raw = value();
      if (!/^\d{1,77}$/.test(raw)) throw new Error("--token-id must be a non-negative integer.");
      args.tokenId = BigInt(raw);
    } else if (flag === "--recipient") {
      try { args.recipient = getAddress(value()); } catch { throw new Error("--recipient must be a valid address."); }
    } else throw new Error(`Unknown option ${flag}.`);
  }
  if (args.broadcast && args.verify) throw new Error("Choose --broadcast or --verify, not both.");
  if (args.broadcast && (args.tokenId == null || !args.recipient)) {
    throw new Error("--broadcast needs the --token-id and --recipient shown by the dry run. Nothing was signed.");
  }
  return args;
}

function revertName(contract, error) {
  const data = error?.data ?? error?.info?.error?.data?.data ?? error?.info?.error?.data;
  try { return contract.interface.parseError(typeof data === "string" ? data : data?.data)?.name ?? null; } catch { return null; }
}

// eth_call from an address needs no signature, so control can be shown for both owners.
async function simulate(adapter, from, method, args, blockTag) {
  try {
    await adapter[method].staticCall(...args, { ...READ, from, blockTag });
    return { from, allowed: true };
  } catch (error) {
    const name = revertName(adapter, error);
    if (!name) throw error;
    return { from, allowed: false, error: name };
  }
}

async function withReadRetry(fn, { attempts = 5, delayMs = 1000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (error) {
      // A load-balanced RPC node can lag the receipt's block; never retry a failed proof check.
      if (error.code === "PROOF_CHECK_FAILED" || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** Read-only checks before anything is signed. Rejections are deterministic and stop endpoint fallback. */
export async function checkProofTarget(provider, cfg) {
  const { chainId } = await provider.getNetwork();
  if (chainId !== BigInt(cfg.chainId)) reject(`The proof requires chain ${cfg.chainId}; received ${chainId}.`);
  const owner = getAddress(cfg.owner);
  const recipient = getAddress(cfg.recipient);
  if (recipient === owner) reject("The recipient must differ from the current owner.");
  if ([ZeroAddress, getAddress(cfg.adapter), getAddress(cfg.registry), getAddress(cfg.collection)].includes(recipient)) {
    reject("The recipient must be an ordinary second address, not zero or a proof contract.");
  }
  for (const [name, address] of [["adapter", cfg.adapter], ["collection", cfg.collection], ["registry", cfg.registry]]) {
    if (await provider.getCode(address) === "0x") reject(`The ${name} ${address} has no code on this network.`);
  }
  const { adapter, collection } = proofContracts(cfg, provider);
  if (getAddress(await adapter.collection(READ)) !== getAddress(cfg.collection)) reject("The adapter is bound to a different collection.");
  if (getAddress(await adapter.identityRegistry(READ)) !== getAddress(cfg.registry)) reject("The adapter uses a different identity registry.");
  if (!await collection.supportsInterface("0x80ac58cd", READ)) reject("The collection does not support ERC-721.");
  try {
    const holder = await collection.ownerOf(cfg.tokenId, READ);
    reject(`Token ${cfg.tokenId} is already minted to ${holder}; choose another --token-id.`);
  } catch (error) {
    if (error.code === "PREFLIGHT_REJECTED" || revertName(collection, error) !== "ERC721NonexistentToken") throw error;
  }
  return { owner, recipient };
}

/** Unsigned mint preparation plus a funding check for all three transactions. */
export async function prepareMint(signer, provider, cfg) {
  const { collection } = proofContracts(cfg, signer);
  const prepared = await prepareTransaction(signer, await collection.mint.populateTransaction(cfg.owner, cfg.tokenId));
  const maxFee = prepared.maxFeePerGas ?? prepared.gasPrice;
  const budgetGas = prepared.gasLimit + LATER_STEP_GAS_CEILINGS.awaken + LATER_STEP_GAS_CEILINGS.transfer;
  const balance = await provider.getBalance(cfg.owner);
  if (balance < budgetGas * maxFee) reject("The owner needs more test MON for the three proof transactions. Nothing was signed.");
  return { prepared, balance, maxFeePerGas: maxFee, budgetGas, budgetWei: budgetGas * maxFee };
}

export function newProofRecord(cfg, rpcHost) {
  return {
    kind: "chog-awakening-ownership-proof",
    chainId: cfg.chainId,
    adapter: getAddress(cfg.adapter),
    collection: getAddress(cfg.collection),
    registry: getAddress(cfg.registry),
    officialChogCollection: false,
    owner: getAddress(cfg.owner),
    recipient: getAddress(cfg.recipient),
    tokenId: cfg.tokenId.toString(),
    agentURI: cfg.agentURI,
    rpcHost,
    startedAt: new Date().toISOString(),
    status: "started",
    transactions: {},
    checks: {},
  };
}

/** Signs and broadcasts mint, awaken and transfer, persisting each hash before its broadcast. */
export async function runProof({ signer, cfg, record, persist, preparedMint, readRetry }) {
  const save = () => persist(record);
  const { adapter, collection, registry } = proofContracts(cfg, signer.provider);
  const send = async (name, populate, prepared) => {
    const unsigned = prepared ?? await prepareTransaction(signer, await populate());
    record.transactions[name] = { to: getAddress(unsigned.to) };
    return sendAndRecord(signer, unsigned, record.transactions[name], save);
  };
  const owner = getAddress(cfg.owner);
  const recipient = getAddress(cfg.recipient);
  const writable = proofContracts(cfg, signer);

  const minted = await send("mint", () => writable.collection.mint.populateTransaction(owner, cfg.tokenId), preparedMint);
  await withReadRetry(async () => {
    expect(getAddress(await collection.ownerOf(cfg.tokenId, { ...READ, blockTag: minted.blockNumber })) === owner, "minted token is not held by the owner");
  }, readRetry);

  const awakened = await send("awaken", () => writable.adapter.awaken.populateTransaction(cfg.tokenId, cfg.agentURI));
  record.checks.afterAwaken = await withReadRetry(async () => {
    const blockTag = awakened.blockNumber;
    const agentId = await adapter.agentOf(cfg.tokenId, { ...READ, blockTag });
    const binding = await adapter.bindingOf(agentId, { ...READ, blockTag });
    const controller = getAddress(await adapter.controllerOf(agentId, { ...READ, blockTag }));
    const identityOwner = getAddress(await registry.ownerOf(agentId, { ...READ, blockTag }));
    const agentBinding = await registry.getMetadata(agentId, "agent-binding", { ...READ, blockTag });
    const ownerSetAgentURI = await simulate(adapter, owner, "setAgentURI", [agentId, cfg.agentURI], blockTag);
    expect(getAddress(binding.tokenContract) === getAddress(cfg.collection) && binding.tokenId === cfg.tokenId, "binding does not name the minted token");
    expect(controller === owner, "controllerOf is not the owner after awakening");
    expect(identityOwner === getAddress(cfg.adapter), "the adapter does not hold the identity NFT");
    expect(agentBinding.toLowerCase() === cfg.adapter.toLowerCase(), "agent-binding metadata is not the adapter address");
    expect(ownerSetAgentURI.allowed, "the owner cannot manage the agent");
    return {
      blockNumber: blockTag, agentId: agentId.toString(),
      binding: { standard: Number(binding.standard), collection: getAddress(binding.tokenContract), tokenId: binding.tokenId.toString() },
      controller, identityOwner, agentBinding, ownerSetAgentURI,
    };
  }, readRetry);
  record.agentId = record.checks.afterAwaken.agentId;
  await save();

  const transferred = await send("transfer", () => writable.collection.transferFrom.populateTransaction(owner, recipient, cfg.tokenId));
  record.checks.afterTransfer = await withReadRetry(() => transferChecks({ adapter, collection, registry }, record, transferred.blockNumber), readRetry);
  record.status = "passed";
  record.finishedAt = new Date().toISOString();
  await save();
  return record;
}

async function transferChecks({ adapter, collection, registry }, record, blockTag) {
  const agentId = BigInt(record.agentId);
  const tokenId = BigInt(record.tokenId);
  const controller = getAddress(await adapter.controllerOf(agentId, { ...READ, blockTag }));
  const nftOwner = getAddress(await collection.ownerOf(tokenId, { ...READ, blockTag }));
  const identityOwner = getAddress(await registry.ownerOf(agentId, { ...READ, blockTag }));
  const binding = await adapter.bindingOf(agentId, { ...READ, blockTag });
  const probeURI = "ipfs://chog-awakening/ownership-probe";
  const oldOwner = {
    setAgentURI: await simulate(adapter, record.owner, "setAgentURI", [agentId, probeURI], blockTag),
    setMetadata: await simulate(adapter, record.owner, "setMetadata", [agentId, "proof", "0x01"], blockTag),
  };
  const newOwner = {
    setAgentURI: await simulate(adapter, record.recipient, "setAgentURI", [agentId, probeURI], blockTag),
    setMetadata: await simulate(adapter, record.recipient, "setMetadata", [agentId, "proof", "0x01"], blockTag),
  };
  expect(nftOwner === record.recipient, "the NFT is not held by the recipient");
  expect(controller === record.recipient, "controllerOf did not follow the NFT to the recipient");
  expect(identityOwner === record.adapter, "the identity NFT left the adapter");
  expect(getAddress(binding.tokenContract) === record.collection && binding.tokenId === tokenId, "the binding changed");
  for (const method of ["setAgentURI", "setMetadata"]) {
    expect(oldOwner[method].error === "NotTokenOwner", `the old owner's ${method} was not rejected with NotTokenOwner`);
    expect(newOwner[method].allowed, `the new owner's ${method} simulation was rejected`);
  }
  return { blockNumber: blockTag, nftOwner, controller, identityOwner, oldOwner, newOwner };
}

const expectedCalls = (record) => ({
  mint: { to: record.collection, contract: "TestChog", method: "mint", args: [record.owner, BigInt(record.tokenId)] },
  awaken: { to: record.adapter, contract: "ChogAdapter", method: "awaken", args: [BigInt(record.tokenId), record.agentURI] },
  transfer: { to: record.collection, contract: "TestChog", method: "transferFrom", args: [record.owner, record.recipient, BigInt(record.tokenId)] },
});

/** Read-only: re-fetches every saved receipt and transaction, then re-runs the post-transfer checks. */
export async function verifyProofRecord(provider, record, { chainId }) {
  const { chainId: actual } = await provider.getNetwork();
  if (actual !== BigInt(chainId)) reject(`Verification requires chain ${chainId}; received ${actual}.`);
  const calls = expectedCalls(record);
  const transactions = {};
  for (const name of STEPS) {
    const saved = record.transactions?.[name];
    expect(saved?.transactionHash, `the record has no ${name} transaction hash`);
    const receipt = await provider.send("eth_getTransactionReceipt", [saved.transactionHash]);
    const transaction = await provider.send("eth_getTransactionByHash", [saved.transactionHash]);
    expect(receipt && transaction, `no receipt or transaction is visible for ${name} ${saved.transactionHash}`);
    const call = calls[name];
    const decoded = new Interface(loadArtifact(call.contract).abi).parseTransaction({ data: transaction.input });
    expect(BigInt(receipt.status) === 1n, `${name} did not succeed`);
    expect(getAddress(transaction.from) === record.owner, `${name} was not sent by the owner`);
    expect(getAddress(transaction.to) === call.to, `${name} was sent to the wrong contract`);
    expect(Number(BigInt(transaction.nonce)) === saved.nonce, `${name} nonce differs from the record`);
    expect(saved.blockNumber == null || Number(BigInt(receipt.blockNumber)) === saved.blockNumber, `${name} block differs from the record`);
    expect(decoded?.name === call.method && JSON.stringify(decoded.args.toArray(), stringify) === JSON.stringify(call.args, stringify), `${name} calldata differs from the planned call`);
    transactions[name] = { transactionHash: saved.transactionHash, blockNumber: Number(BigInt(receipt.blockNumber)), status: 1, from: getAddress(transaction.from), to: call.to, nonce: saved.nonce, call: call.method };
  }
  const contracts = proofContracts(record, provider);
  expect(getAddress(await contracts.adapter.collection(READ)) === record.collection, "the adapter's collection differs from the record");
  expect((await contracts.adapter.agentOf(BigInt(record.tokenId), READ)).toString() === record.agentId, "agentOf differs from the record");
  // Nodes may prune old state, so current state is checked at one pinned block.
  const checkedBlock = Number(BigInt(await provider.send("eth_blockNumber", [])));
  const current = await transferChecks(contracts, record, checkedBlock);
  return { readOnly: true, checkedAt: new Date().toISOString(), chainId, tokenId: record.tokenId, agentId: record.agentId, transactions, current };
}

function stringify(_, value) {
  return typeof value === "bigint" ? value.toString() : typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? getAddress(value) : value;
}
