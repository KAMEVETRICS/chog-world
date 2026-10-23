import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface, ZeroAddress } from "ethers";
import { artifact, fixture, reverted, deploy, localChain, registryFixture, adapterArgs, tokenAccounts } from "./helpers.mjs";

test("agent management follows an NFT transfer while identity custody and binding persist", async (t) => {
  const f = await fixture();
  t.after(() => f.connection.close());
  const alice = await f.alice.getAddress();
  const bob = await f.bob.getAddress();
  const adapter = await f.adapter.getAddress();
  await (await f.collection.mint(alice, 7n)).wait();
  await (await f.adapter.awaken(7n, "ipfs://chog-before")).wait();
  const agentId = await f.adapter.agentOf(7n);
  assert.equal(agentId, 0n, "the real registry's first agent ID is valid zero");
  assert.equal(await f.registry.getVersion(), "2.0.0");
  assert.equal(await f.registry.ownerOf(agentId), adapter);
  assert.equal(await f.registry.getAgentWallet(agentId), ZeroAddress);
  assert.equal(await f.registry.getMetadata(agentId, "agent-binding"), adapter.toLowerCase());
  const bindingBefore = Array.from(await f.adapter.bindingOf(agentId));
  assert.deepEqual(bindingBefore, [0n, await f.collection.getAddress(), 7n]);

  await (await f.adapter.setAgentURI(agentId, "ipfs://alice-update")).wait();
  await (await f.collection.transferFrom(alice, bob, 7n)).wait();
  assert.equal(await f.adapter.controllerOf(agentId), bob);
  await reverted(f.adapter.setAgentURI(agentId, "ipfs://stale-owner"), f.adapter, "NotTokenOwner");
  await (await f.adapter.connect(f.bob).setAgentURI(agentId, "ipfs://bob-update")).wait();
  await (await f.adapter.connect(f.bob).setMetadata(agentId, "mood", "0x1234")).wait();
  assert.equal(await f.registry.tokenURI(agentId), "ipfs://bob-update");
  assert.equal(await f.registry.getMetadata(agentId, "mood"), "0x1234");
  assert.equal(await f.registry.ownerOf(agentId), adapter);
  assert.equal(await f.registry.getAgentWallet(agentId), ZeroAddress);
  assert.deepEqual(Array.from(await f.adapter.bindingOf(agentId)), bindingBefore);
});

test("only the current NFT owner can awaken or manage, including when an operator is approved", async (t) => {
  const f = await fixture();
  t.after(() => f.connection.close());
  await (await f.collection.mint(await f.alice.getAddress(), 1n)).wait();
  await (await f.collection.approve(await f.operator.getAddress(), 1n)).wait();
  for (const signer of [f.outsider, f.operator]) {
    await reverted(f.adapter.connect(signer).awaken(1n, "ipfs://unauthorized"), f.adapter, "NotTokenOwner");
  }
  await (await f.adapter.awaken(1n, "ipfs://owner")).wait();
  for (const signer of [f.outsider, f.operator]) {
    await reverted(f.adapter.connect(signer).setAgentURI(0n, "ipfs://unauthorized"), f.adapter, "NotTokenOwner");
    await reverted(f.adapter.connect(signer).setMetadata(0n, "mood", "0xab"), f.adapter, "NotTokenOwner");
  }
  await assert.rejects(f.registry.setAgentURI(0n, "ipfs://bypass"));
  await assert.rejects(f.registry.setMetadata(0n, "agent-binding", "0x1234"));
  assert.equal(await f.registry.getApproved(0n), ZeroAddress);
});

test("token zero and agent zero work and cannot be awakened twice before or after transfer", async (t) => {
  const f = await fixture();
  t.after(() => f.connection.close());
  const alice = await f.alice.getAddress();
  const bob = await f.bob.getAddress();
  await (await f.collection.mint(alice, 0n)).wait();
  const receipt = await (await f.adapter.awaken(0n, "ipfs://zero")).wait();
  const bound = receipt.logs.map((log) => { try { return f.adapter.interface.parseLog(log); } catch { return null; } })
    .find((log) => log?.name === "AgentBound");
  assert.deepEqual(Array.from(bound.args), [0n, 0n, await f.collection.getAddress(), 0n, alice]);
  assert.equal(await f.adapter.agentOf(0n), 0n);
  await reverted(f.adapter.awaken(0n, "ipfs://duplicate"), f.adapter, "AlreadyAwakened");
  await (await f.collection.transferFrom(alice, bob, 0n)).wait();
  await reverted(f.adapter.connect(f.bob).awaken(0n, "ipfs://duplicate"), f.adapter, "AlreadyAwakened");
  await (await f.collection.mint(bob, 2n)).wait();
  await (await f.adapter.connect(f.bob).awaken(2n, "ipfs://second")).wait();
  assert.equal(await f.adapter.agentOf(2n), 1n);
  assert.equal(await f.adapter.agentOf(0n), 0n);
});

test("reserved metadata cannot corrupt immutable discovery or enable a payment wallet", async (t) => {
  const f = await fixture();
  t.after(() => f.connection.close());
  await (await f.collection.mint(await f.alice.getAddress(), 1n)).wait();
  await (await f.adapter.awaken(1n, "ipfs://reserved")).wait();
  for (const key of ["agent-binding", "agentWallet"]) {
    await reverted(f.adapter.setMetadata(0n, key, await f.outsider.getAddress()), f.adapter, "ReservedMetadata");
  }
  assert.equal(await f.registry.getMetadata(0n, "agent-binding"), (await f.adapter.getAddress()).toLowerCase());
  assert.equal(await f.registry.getAgentWallet(0n), ZeroAddress);
});

test("unknown agents, unawakened NFTs, and nonexistent or burned NFTs fail safely", async (t) => {
  const f = await fixture();
  t.after(() => f.connection.close());
  await reverted(f.adapter.agentOf(99n), f.adapter, "NotAwakened");
  await reverted(f.adapter.bindingOf(99n), f.adapter, "UnknownAgent");
  await reverted(f.adapter.controllerOf(99n), f.adapter, "UnknownAgent");
  await reverted(f.adapter.setAgentURI(99n, "ipfs://unknown"), f.adapter, "UnknownAgent");
  await reverted(f.adapter.setMetadata(99n, "mood", "0x"), f.adapter, "UnknownAgent");
  await reverted(f.adapter.awaken(99n, "ipfs://missing"), f.collection, "ERC721NonexistentToken");
  await (await f.collection.mint(await f.alice.getAddress(), 1n)).wait();
  await (await f.adapter.awaken(1n, "ipfs://burned")).wait();
  await (await f.collection.burn(1n)).wait();
  await reverted(f.adapter.controllerOf(0n), f.collection, "ERC721NonexistentToken");
  await reverted(f.adapter.setAgentURI(0n, "ipfs://burned-update"), f.collection, "ERC721NonexistentToken");
});

test("unsolicited receiver calls and safe transfers of Chogs or registry identities are rejected", async (t) => {
  const f = await fixture();
  t.after(() => f.connection.close());
  const alice = await f.alice.getAddress();
  const adapter = await f.adapter.getAddress();
  await reverted(f.adapter.onERC721Received(adapter, ZeroAddress, 0n, "0x"), f.adapter, "UnexpectedNFT");
  await (await f.collection.mint(alice, 1n)).wait();
  await reverted(f.collection["safeTransferFrom(address,address,uint256)"](alice, adapter, 1n), f.adapter, "UnexpectedNFT");
  assert.equal(await f.collection.ownerOf(1n), alice);
  await (await f.registry["register(string)"]("ipfs://unrelated")).wait();
  await reverted(f.registry["safeTransferFrom(address,address,uint256)"](alice, adapter, 0n), f.adapter, "UnexpectedNFT");
  assert.equal(await f.registry.ownerOf(0n), alice);
});

test("constructor rejects missing or non-ERC721 contracts, missing ERC-6551 contracts, and using the registry as its own collection", async (t) => {
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const [alice] = chain.signers;
  const registry = await registryFixture(alice);
  const collection = await deploy("TestChog", alice);
  const sample = { interface: new Interface(artifact("ChogAdapter").abi) };
  const good = await adapterArgs(collection, registry, await tokenAccounts(alice));
  const withArg = (index, value) => good.map((arg, position) => position === index ? value : arg);
  for (const bad of [ZeroAddress, await alice.getAddress()]) {
    // Collection, identity registry, ERC-6551 registry and account implementation must all be contracts.
    for (const index of [0, 1, 2, 3]) await reverted(deploy("ChogAdapter", alice, withArg(index, bad)), sample, "InvalidContract");
  }
  await reverted(deploy("ChogAdapter", alice, withArg(0, good[1])), sample, "InvalidContract");
});

test("a rejected registration, wrong mint, or failed wallet clear rolls back awakening for a valid retry", async (t) => {
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const [alice] = chain.signers;
  const collection = await deploy("TestChog", alice);
  const registry = await deploy("FaultyRegistry", alice);
  const adapter = await deploy("ChogAdapter", alice, await adapterArgs(collection, registry, await tokenAccounts(alice)));
  await (await collection.mint(await alice.getAddress(), 1n)).wait();
  for (const mode of [1n, 2n, 3n]) {
    await (await registry.setMode(mode)).wait();
    await assert.rejects(adapter.awaken(1n, "ipfs://rejected"));
    await reverted(adapter.agentOf(1n), adapter, "NotAwakened");
    await reverted(adapter.bindingOf(0n), adapter, "UnknownAgent");
  }
  await (await registry.setMode(0n)).wait();
  await (await adapter.awaken(1n, "ipfs://retry")).wait();
  assert.equal(await adapter.agentOf(1n), 0n);
  assert.equal(await registry.ownerOf(0n), await adapter.getAddress());
});

test("reentrant awakening is rejected even when a hostile registry owns the Chog", async (t) => {
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const [alice] = chain.signers;
  const collection = await deploy("TestChog", alice);
  const registry = await deploy("FaultyRegistry", alice);
  const adapter = await deploy("ChogAdapter", alice, await adapterArgs(collection, registry, await tokenAccounts(alice)));
  await (await collection.mint(await registry.getAddress(), 1n)).wait();
  await (await registry.setMode(4n)).wait();
  await (await registry.startReentry(await adapter.getAddress(), 1n)).wait();
  assert.equal(await registry.reentryBlocked(), true);
  assert.equal(await adapter.agentOf(1n), 0n);
});
