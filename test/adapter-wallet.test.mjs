import assert from "node:assert/strict";
import { test } from "node:test";
import { Contract, ZeroAddress, ZeroHash, id } from "ethers";
import { artifact, deploy, fixture, registryFixture, reverted, validationRegistryFixture } from "./helpers.mjs";

async function awakenedWithAccount(t, tokenId = 7n) {
  const f = await fixture();
  t.after(() => f.connection.close());
  await (await f.collection.mint(await f.alice.getAddress(), tokenId)).wait();
  await (await f.adapter.awaken(tokenId, "ipfs://wallet")).wait();
  const agentId = await f.adapter.agentOf(tokenId);
  const { chainId } = await f.provider.getNetwork();
  const collection = await f.collection.getAddress();
  await (await f.accounts.registry.createAccount(await f.accounts.implementation.getAddress(), ZeroHash, chainId, collection, tokenId)).wait();
  const account = await f.adapter.tokenAccountOf(tokenId);
  return { ...f, tokenId, agentId, chainId, account };
}

// The holder's EOA signs the registry's EIP-712 digest; the token-bound account accepts it through ERC-1271.
async function walletSignature(f, signer, agentId, deadline) {
  const domain = { name: "ERC8004IdentityRegistry", version: "1", chainId: f.chainId, verifyingContract: await f.registry.getAddress() };
  const types = { AgentWalletSet: [
    { name: "agentId", type: "uint256" }, { name: "newWallet", type: "address" },
    { name: "owner", type: "address" }, { name: "deadline", type: "uint256" },
  ] };
  return signer.signTypedData(domain, types, { agentId, newWallet: f.account, owner: await f.adapter.getAddress(), deadline });
}

async function deadline(f) {
  return BigInt((await f.provider.getBlock("latest")).timestamp) + 120n;
}

test("the agent wallet can only be the Chog's ERC-6551 account and follows the NFT on transfer", async (t) => {
  const f = await awakenedWithAccount(t);
  const alice = await f.alice.getAddress();
  const bob = await f.bob.getAddress();
  const expected = await f.accounts.registry.account(await f.accounts.implementation.getAddress(), ZeroHash, f.chainId, await f.collection.getAddress(), f.tokenId);
  assert.equal(f.account, expected);

  const expiry = await deadline(f);
  const aliceSignature = await walletSignature(f, f.alice, f.agentId, expiry);
  await (await f.adapter.setAgentWallet(f.agentId, expiry, aliceSignature)).wait();
  assert.equal(await f.registry.getAgentWallet(f.agentId), f.account);

  const tokenAccount = new Contract(f.account, artifact("TestTokenAccount").abi, f.provider);
  assert.equal(await tokenAccount.owner(), alice);
  await (await f.collection.transferFrom(alice, bob, f.tokenId)).wait();
  assert.equal(await f.registry.getAgentWallet(f.agentId), f.account, "the wallet needs no clean-up after a sale");
  assert.equal(await tokenAccount.owner(), bob, "the buyer controls the agent's wallet");

  await reverted(f.adapter.setAgentWallet(f.agentId, expiry, aliceSignature), f.adapter, "NotTokenOwner");
  await reverted(f.adapter.unsetAgentWallet(f.agentId), f.adapter, "NotTokenOwner");
  await (await f.adapter.connect(f.bob).unsetAgentWallet(f.agentId)).wait();
  assert.equal(await f.registry.getAgentWallet(f.agentId), ZeroAddress);
  // The seller's signature no longer validates for the account once the buyer holds the Chog.
  await assert.rejects(f.adapter.connect(f.bob).setAgentWallet(f.agentId, expiry, aliceSignature), /invalid wallet sig/);
  await (await f.adapter.connect(f.bob).setAgentWallet(f.agentId, expiry, await walletSignature(f, f.bob, f.agentId, expiry))).wait();
  assert.equal(await f.registry.getAgentWallet(f.agentId), f.account);
  assert.equal(await f.registry.ownerOf(f.agentId), await f.adapter.getAddress());
});

test("setting the agent wallet rejects outsiders, operators, unknown agents, bad signatures and undeployed accounts", async (t) => {
  const f = await awakenedWithAccount(t);
  const expiry = await deadline(f);
  const signature = await walletSignature(f, f.alice, f.agentId, expiry);
  await (await f.collection.approve(await f.operator.getAddress(), f.tokenId)).wait();
  for (const signer of [f.outsider, f.operator]) {
    await reverted(f.adapter.connect(signer).setAgentWallet(f.agentId, expiry, signature), f.adapter, "NotTokenOwner");
    await reverted(f.adapter.connect(signer).unsetAgentWallet(f.agentId), f.adapter, "NotTokenOwner");
  }
  await reverted(f.adapter.setAgentWallet(99n, expiry, signature), f.adapter, "UnknownAgent");
  await assert.rejects(f.adapter.setAgentWallet(f.agentId, expiry, await walletSignature(f, f.outsider, f.agentId, expiry)), /invalid wallet sig/);
  await assert.rejects(f.registry.setAgentWallet(f.agentId, f.account, expiry, signature), /Not authorized/);

  await (await f.collection.mint(await f.alice.getAddress(), 8n)).wait();
  await (await f.adapter.awaken(8n, "ipfs://no-account")).wait();
  const secondAgent = await f.adapter.agentOf(8n);
  await reverted(f.adapter.setAgentWallet(secondAgent, expiry, signature), f.adapter, "TokenAccountNotDeployed");
  assert.equal(await f.registry.getAgentWallet(secondAgent), ZeroAddress);
});

test("the current holder can request ERC-8004 validation for their own agent only", async (t) => {
  const f = await awakenedWithAccount(t);
  const validation = await validationRegistryFixture(f.alice, f.registry);
  const target = await validation.getAddress();
  const validator = await f.operator.getAddress();
  const requestHash = id("chog-validation-1");
  await assert.rejects(validation.validationRequest(validator, f.agentId, "ipfs://req", requestHash), /Not authorized/);
  await (await f.adapter.requestValidation(target, validator, f.agentId, "ipfs://req", requestHash)).wait();
  const status = await validation.getValidationStatus(requestHash);
  assert.equal(status[0], validator);
  assert.equal(status[1], f.agentId);

  await (await f.collection.mint(await f.bob.getAddress(), 9n)).wait();
  await (await f.adapter.connect(f.bob).awaken(9n, "ipfs://bob")).wait();
  const bobAgent = await f.adapter.agentOf(9n);
  await reverted(f.adapter.requestValidation(target, validator, bobAgent, "ipfs://req", id("not-alices")), f.adapter, "NotTokenOwner");

  await (await f.collection.transferFrom(await f.alice.getAddress(), await f.bob.getAddress(), f.tokenId)).wait();
  await reverted(f.adapter.requestValidation(target, validator, f.agentId, "ipfs://req", id("stale")), f.adapter, "NotTokenOwner");
  await (await f.adapter.connect(f.bob).requestValidation(target, validator, f.agentId, "ipfs://req", id("new-owner"))).wait();
});

test("validation requests only go to a validation registry bound to the adapter's identity registry", async (t) => {
  const f = await awakenedWithAccount(t);
  const otherIdentity = await registryFixture(f.alice);
  const foreign = await validationRegistryFixture(f.alice, otherIdentity);
  const unrelated = await deploy("TestChog", f.alice);
  const validator = await f.operator.getAddress();
  for (const target of [await foreign.getAddress(), await f.registry.getAddress(), await f.collection.getAddress(), await unrelated.getAddress(), await f.outsider.getAddress()]) {
    await reverted(f.adapter.requestValidation(target, validator, f.agentId, "ipfs://req", id(target)), f.adapter, "InvalidContract");
  }
});
