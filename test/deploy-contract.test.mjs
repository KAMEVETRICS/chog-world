import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { ContractFactory, NonceManager, Transaction, VoidSigner, Wallet } from "ethers";
import { artifact, localChain } from "./helpers.mjs";

test("deployment preparation completes with a signer that cannot sign or broadcast", async (t) => {
  const { prepareDeployment } = await import("../scripts/deploy-contract.mjs");
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const address = await chain.signers[0].getAddress();
  const signer = new VoidSigner(address, chain.provider);
  const compiled = artifact("TestChog");
  const factory = new ContractFactory(compiled.abi, compiled.bytecode, signer);
  chain.provider.broadcastTransaction = async () => assert.fail("preparation must never broadcast");
  const unsigned = await prepareDeployment(factory, []);
  assert.equal(unsigned.from, address);
  assert.equal(unsigned.nonce, 0);
  assert.equal(unsigned.chainId, 31337n);
  assert.ok(unsigned.gasLimit > 0n);
  assert.notEqual(unsigned.gasLimit, 8_000_000n);
  assert.equal(await chain.provider.getCode(await signer.getAddress()), "0x");
});

test("a prepared deployment is signed without repeating its RPC preparation", async (t) => {
  const { prepareDeployment, deployAndRecord } = await import("../scripts/deploy-contract.mjs");
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const signer = new NonceManager(Wallet.fromPhrase("test test test test test test test test test test test junk").connect(chain.provider));
  const compiled = artifact("TestChog");
  const factory = new ContractFactory(compiled.abi, compiled.bytecode, signer);
  const prepared = await prepareDeployment(factory, []);
  const estimate = signer.estimateGas.bind(signer);
  const populate = signer.populateTransaction.bind(signer);
  signer.estimateGas = async () => assert.fail("prepared deployment must not estimate again");
  signer.populateTransaction = async () => assert.fail("prepared deployment must not populate again");
  const states = [];
  const receipt = await deployAndRecord(factory, [], (record) => states.push(record.status), { prepared });
  assert.deepEqual(states, ["prepared", "pending", "confirmed"]);
  assert.equal(receipt.nonce, prepared.nonce);
  signer.estimateGas = estimate;
  signer.populateTransaction = populate;
  const second = await deployAndRecord(factory, [], () => {});
  assert.equal(second.nonce, prepared.nonce + 1);
});

test("deployment estimates within the RPC cap and signs with the returned estimate", async (t) => {
  const { deployAndRecord } = await import("../scripts/deploy-contract.mjs");
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const signer = Wallet.fromPhrase("test test test test test test test test test test test junk").connect(chain.provider);
  const compiled = artifact("TestChog");
  const factory = new ContractFactory(compiled.abi, compiled.bytecode, signer);
  const normalEstimate = chain.provider.estimateGas.bind(chain.provider);
  const normalBroadcast = chain.provider.broadcastTransaction.bind(chain.provider);
  let estimatedGas;
  let signedGas;
  chain.provider.estimateGas = async (transaction) => {
    // Reproduce dRPC's rejection of an omitted or excessive simulation gas limit.
    if (transaction.gasLimit == null || BigInt(transaction.gasLimit) > 8_000_000n) {
      throw new Error("user-specified gas exceeds provider limit");
    }
    estimatedGas = await normalEstimate(transaction);
    return estimatedGas;
  };
  chain.provider.broadcastTransaction = async (signed) => {
    signedGas = Transaction.from(signed).gasLimit;
    return normalBroadcast(signed);
  };
  const receipt = await deployAndRecord(factory, [], () => {});
  assert.equal(receipt.status, "confirmed");
  assert.equal(signedGas, estimatedGas, "the transaction must use the estimate, not the simulation cap");
  assert.ok(signedGas < 8_000_000n);
});

test("a mined deployment is recoverable from the persisted pending hash when receipt retrieval fails", async (t) => {
  const { deployAndRecord } = await import("../scripts/deploy-contract.mjs");
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const compiled = artifact("TestChog");
  const signer = Wallet.fromPhrase("test test test test test test test test test test test junk").connect(chain.provider);
  const factory = new ContractFactory(compiled.abi, compiled.bytecode, signer);
  const normalBroadcast = chain.provider.broadcastTransaction.bind(chain.provider);
  chain.provider.broadcastTransaction = async (signed) => {
    const transaction = await normalBroadcast(signed);
    // Simulate only the remote receipt read failing, after a real local deployment was broadcast.
    return { hash: transaction.hash, wait: async () => { throw new Error("RPC disconnected after broadcast"); } };
  };
  fs.mkdirSync(".cache", { recursive: true });
  const directory = fs.mkdtempSync(path.resolve(".cache/deployment-recovery-"));
  const filename = path.join(directory, "receipt.json");
  await assert.rejects(deployAndRecord(factory, [], (record) => {
    fs.writeFileSync(filename, JSON.stringify(record));
  }), /RPC disconnected/);
  const saved = JSON.parse(fs.readFileSync(filename));
  assert.equal(saved.status, "pending");
  assert.match(saved.transactionHash, /^0x[\da-f]{64}$/i);
  const receipt = await chain.provider.getTransactionReceipt(saved.transactionHash);
  assert.equal(receipt.contractAddress, saved.address);
  assert.notEqual(await chain.provider.getCode(saved.address), "0x");
});

test("a successful deployment persists pending state before confirmed state", async (t) => {
  const { deployAndRecord } = await import("../scripts/deploy-contract.mjs");
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const compiled = artifact("TestChog");
  const signer = Wallet.fromPhrase("test test test test test test test test test test test junk").connect(chain.provider);
  const factory = new ContractFactory(compiled.abi, compiled.bytecode, signer);
  const states = [];
  const receipt = await deployAndRecord(factory, [], (record) => states.push(structuredClone(record)));
  assert.deepEqual(states.map((entry) => entry.status), ["prepared", "pending", "confirmed"]);
  assert.equal(states[0].address, states[1].address);
  assert.equal(states[0].transactionHash, states[1].transactionHash);
  assert.equal(receipt.blockNumber, 1);
  assert.equal(receipt.status, "confirmed");
});

test("sequential deployments consume distinct managed nonces", async (t) => {
  const { deployAndRecord } = await import("../scripts/deploy-contract.mjs");
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const signer = new NonceManager(Wallet.fromPhrase("test test test test test test test test test test test junk").connect(chain.provider));
  const compiled = artifact("TestChog");
  const factory = new ContractFactory(compiled.abi, compiled.bytecode, signer);
  const first = await deployAndRecord(factory, [], () => {});
  const second = await deployAndRecord(factory, [], () => {});
  assert.equal(first.nonce, 0);
  assert.equal(second.nonce, 1);
  assert.notEqual(first.address, second.address);
  assert.notEqual(await chain.provider.getCode(second.address), "0x");
});

test("the signed hash is saved even when broadcast succeeds but its RPC response is lost", async (t) => {
  const { deployAndRecord } = await import("../scripts/deploy-contract.mjs");
  const chain = await localChain();
  t.after(() => chain.connection.close());
  // Public Hardhat test mnemonic: used only on this isolated local EVM.
  const signer = Wallet.fromPhrase("test test test test test test test test test test test junk").connect(chain.provider);
  const compiled = artifact("TestChog");
  const factory = new ContractFactory(compiled.abi, compiled.bytecode, signer);
  const originalBroadcast = chain.provider.broadcastTransaction.bind(chain.provider);
  let broadcasts = 0;
  chain.provider.broadcastTransaction = async (signed) => {
    broadcasts++;
    await originalBroadcast(signed);
    throw new Error("RPC disconnected after accepting the transaction");
  };
  const saved = [];
  await assert.rejects(deployAndRecord(factory, [], (record) => saved.push(structuredClone(record))), /after accepting/);
  assert.ok(saved.length > 0, "a deployment hash must be recorded before invoking broadcast");
  assert.equal(saved[0].status, "prepared");
  assert.equal(broadcasts, 1, "an ambiguous broadcast must never be retried automatically");
  const receipt = await chain.provider.getTransactionReceipt(saved[0].transactionHash);
  assert.equal(receipt.contractAddress, saved[0].address);
});
