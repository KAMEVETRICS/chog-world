import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress, NonceManager, VoidSigner, Wallet } from "ethers";
import { deploy, localChain, registryFixture, adapterArgs, tokenAccounts } from "./helpers.mjs";
import {
  checkProofTarget, newProofRecord, parseProofArgs, prepareMint, proofAgentURI, runProof, verifyProofRecord,
} from "../scripts/proof-steps.mjs";

// Public Hardhat test mnemonic: account 0 matches the local chain's first signer.
const PHRASE = "test test test test test test test test test test test junk";
const readRetry = { attempts: 2, delayMs: 10 };

async function proofChain(t, tokenId = 42n) {
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const [alice, bob] = chain.signers;
  const collection = await deploy("TestChog", alice);
  const registry = await registryFixture(alice);
  const adapter = await deploy("ChogAdapter", alice, await adapterArgs(collection, registry, await tokenAccounts(alice)));
  const cfg = {
    chainId: 31337, registry: await registry.getAddress(), adapter: await adapter.getAddress(), collection: await collection.getAddress(),
    owner: await alice.getAddress(), recipient: await bob.getAddress(), tokenId, agentURI: proofAgentURI(tokenId),
  };
  const signer = new NonceManager(Wallet.fromPhrase(PHRASE).connect(chain.provider));
  return { ...chain, alice, bob, collection, registry, adapter, cfg, signer };
}

test("the public proof mints, awakens, transfers and shows control following the NFT", async (t) => {
  const c = await proofChain(t);
  await checkProofTarget(c.provider, c.cfg);
  const { prepared } = await prepareMint(c.signer, c.provider, c.cfg);
  const record = newProofRecord(c.cfg, "127.0.0.1");
  const saved = [];
  await runProof({ signer: c.signer, cfg: c.cfg, record, preparedMint: prepared, readRetry, persist: (r) => saved.push(structuredClone(r)) });

  // Each transaction is saved as prepared before broadcast, and finishes before the next one is prepared.
  const timeline = saved.map((r) => Object.entries(r.transactions).map(([name, tx]) => `${name}:${tx.status}`).join(","));
  for (const step of ["mint", "awaken", "transfer"]) {
    const firstPrepared = timeline.findIndex((entry) => entry.includes(`${step}:prepared`));
    assert.ok(firstPrepared >= 0, `${step} must be persisted as prepared`);
    assert.ok(!saved[firstPrepared].transactions[step].blockNumber);
  }
  assert.ok(timeline.indexOf("mint:confirmed") < timeline.findIndex((entry) => entry.includes("awaken:prepared")));
  assert.ok(timeline.findIndex((entry) => entry.includes("awaken:confirmed")) < timeline.findIndex((entry) => entry.includes("transfer:prepared")));

  assert.equal(record.status, "passed");
  assert.equal(record.agentId, "0");
  const { afterAwaken, afterTransfer } = record.checks;
  assert.equal(afterAwaken.controller, c.cfg.owner);
  assert.deepEqual(afterAwaken.binding, { standard: 0, collection: c.cfg.collection, tokenId: "42" });
  assert.equal(afterAwaken.identityOwner, c.cfg.adapter);
  assert.equal(afterTransfer.controller, c.cfg.recipient);
  assert.equal(afterTransfer.nftOwner, c.cfg.recipient);
  assert.deepEqual([afterTransfer.oldOwner.setAgentURI.error, afterTransfer.oldOwner.setMetadata.error], ["NotTokenOwner", "NotTokenOwner"]);
  assert.deepEqual([afterTransfer.newOwner.setAgentURI.allowed, afterTransfer.newOwner.setMetadata.allowed], [true, true]);

  // The simulated rejection matches a real transaction from the old owner.
  await assert.rejects(c.adapter.connect(c.alice).setAgentURI(0n, "ipfs://stale"));
  assert.equal(await c.adapter.controllerOf(0n), c.cfg.recipient);
  assert.equal(await c.registry.tokenURI(0n), c.cfg.agentURI);

  const verified = await verifyProofRecord(c.provider, record, { chainId: 31337 });
  assert.deepEqual(Object.keys(verified.transactions), ["mint", "awaken", "transfer"]);
  assert.equal(verified.transactions.awaken.call, "awaken");
  assert.equal(verified.current.controller, c.cfg.recipient);
});

test("dry-run checks and mint preparation never sign or broadcast", async (t) => {
  const c = await proofChain(t);
  c.provider.broadcastTransaction = async () => assert.fail("a dry run must never broadcast");
  const signer = new VoidSigner(c.cfg.owner, c.provider);
  await checkProofTarget(c.provider, c.cfg);
  const plan = await prepareMint(signer, c.provider, c.cfg);
  assert.equal(plan.prepared.nonce, await c.provider.getTransactionCount(c.cfg.owner));
  assert.ok(plan.prepared.gasLimit > 0n && plan.prepared.gasLimit < 8_000_000n);
  assert.ok(plan.budgetWei > 0n && plan.balance > plan.budgetWei);
  await assert.rejects(c.collection.ownerOf(42n));
});

test("preflight rejects a minted token, same-address recipient and a mismatched adapter before signing", async (t) => {
  const c = await proofChain(t);
  await (await c.collection.mint(c.cfg.owner, 42n)).wait();
  await assert.rejects(checkProofTarget(c.provider, c.cfg), (error) => error.code === "PREFLIGHT_REJECTED" && /already minted/.test(error.message));
  await assert.rejects(checkProofTarget(c.provider, { ...c.cfg, tokenId: 43n, recipient: c.cfg.owner }), /must differ/);
  await assert.rejects(checkProofTarget(c.provider, { ...c.cfg, tokenId: 43n, recipient: c.cfg.adapter }), /ordinary second address/);
  const other = await deploy("TestChog", c.alice);
  await assert.rejects(checkProofTarget(c.provider, { ...c.cfg, tokenId: 43n, collection: await other.getAddress() }), /different collection/);
  await assert.rejects(checkProofTarget(c.provider, { ...c.cfg, tokenId: 43n, chainId: 10143 }), /requires chain 10143/);
  await checkProofTarget(c.provider, { ...c.cfg, tokenId: 43n });
});

test("a lost broadcast response leaves the saved mint hash and stops without retrying or continuing", async (t) => {
  const c = await proofChain(t);
  const original = c.provider.broadcastTransaction.bind(c.provider);
  let broadcasts = 0;
  c.provider.broadcastTransaction = async (signed) => {
    broadcasts++;
    await original(signed);
    throw new Error("RPC disconnected after accepting the transaction");
  };
  const record = newProofRecord(c.cfg, "127.0.0.1");
  let saved;
  await assert.rejects(runProof({ signer: c.signer, cfg: c.cfg, record, readRetry, persist: (r) => { saved = structuredClone(r); } }), /after accepting/);
  assert.equal(broadcasts, 1);
  assert.deepEqual(Object.keys(saved.transactions), ["mint"]);
  assert.equal(saved.transactions.mint.status, "prepared");
  const receipt = await c.provider.getTransactionReceipt(saved.transactions.mint.transactionHash);
  assert.equal(receipt.status, 1);
  assert.equal(getAddress(await c.collection.ownerOf(42n)), c.cfg.owner);
});

test("read-only verification rejects records that do not match the chain", async (t) => {
  const c = await proofChain(t);
  const record = newProofRecord(c.cfg, "127.0.0.1");
  await runProof({ signer: c.signer, cfg: c.cfg, record, readRetry, persist: () => {} });
  const tampered = (change) => { const copy = structuredClone(record); change(copy); return copy; };
  await assert.rejects(verifyProofRecord(c.provider, tampered((r) => { r.recipient = c.cfg.owner; }), { chainId: 31337 }), /calldata differs/);
  await assert.rejects(verifyProofRecord(c.provider, tampered((r) => { r.transactions.awaken = r.transactions.mint; }), { chainId: 31337 }), /wrong contract/);
  await assert.rejects(verifyProofRecord(c.provider, tampered((r) => { r.transactions.transfer.nonce += 1; }), { chainId: 31337 }), /nonce differs/);
  await assert.rejects(verifyProofRecord(c.provider, tampered((r) => { delete r.transactions.transfer; }), { chainId: 31337 }), /no transfer transaction/);
  // A later transfer back means the saved controller claim is no longer current.
  await (await c.collection.connect(c.bob).transferFrom(c.cfg.recipient, c.cfg.owner, 42n)).wait();
  await assert.rejects(verifyProofRecord(c.provider, record, { chainId: 31337 }), /not held by the recipient/);
});

test("broadcast arguments must repeat the dry run's token ID and recipient", () => {
  assert.throws(() => parseProofArgs(["--broadcast"]), /--token-id and --recipient/);
  assert.throws(() => parseProofArgs(["--broadcast", "--token-id", "5"]), /--token-id and --recipient/);
  assert.throws(() => parseProofArgs(["--token-id", "-1"]), /non-negative integer/);
  assert.throws(() => parseProofArgs(["--recipient", "0x1234"]), /valid address/);
  assert.throws(() => parseProofArgs(["--verify"]), /needs a value/);
  assert.throws(() => parseProofArgs(["--broadcast", "--verify", "x.json", "--token-id", "1", "--recipient", "0x0000000000000000000000000000000000000001"]), /not both/);
  assert.throws(() => parseProofArgs(["--private-key", "0x01"]), /Unknown option/);
  const args = parseProofArgs(["--broadcast", "--token-id", "7", "--recipient", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"]);
  assert.deepEqual(args, { broadcast: true, verify: null, tokenId: 7n, recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" });
  assert.match(proofAgentURI(7n), /^data:application\/json;base64,/);
  assert.match(Buffer.from(proofAgentURI(7n).split(",")[1], "base64").toString(), /Not an official Chog/);
});
