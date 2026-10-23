import assert from "node:assert/strict";
import fs from "node:fs";
import { ZeroAddress } from "ethers";
import { fixture, reverted } from "../test/helpers.mjs";

const f = await fixture();
try {
  const alice = await f.alice.getAddress();
  const bob = await f.bob.getAddress();
  const adapter = await f.adapter.getAddress();
  await (await f.collection.mint(alice, 1n)).wait();
  const awaken = await (await f.adapter.awaken(1n, "ipfs://chog-awakening/demo")).wait();
  const agentId = await f.adapter.agentOf(1n);
  await (await f.adapter.setMetadata(agentId, "chapter", "0x01")).wait();
  const transfer = await (await f.collection.transferFrom(alice, bob, 1n)).wait();
  await reverted(f.adapter.setAgentURI(agentId, "ipfs://stale-owner"), f.adapter, "NotTokenOwner");
  await (await f.adapter.connect(f.bob).setAgentURI(agentId, "ipfs://chog-awakening/new-owner")).wait();
  assert.equal(await f.adapter.controllerOf(agentId), bob);
  assert.equal(await f.registry.ownerOf(agentId), adapter);
  assert.equal(await f.registry.getAgentWallet(agentId), ZeroAddress);
  assert.equal(await f.registry.getMetadata(agentId, "chapter"), "0x01");
  const result = {
    environment: "LOCAL SIMULATED EVM ONLY — no public-chain transaction",
    registryVersion: await f.registry.getVersion(),
    tokenId: "1", agentId: agentId.toString(), adapter, collection: await f.collection.getAddress(),
    awakenTransaction: awaken.hash, transferTransaction: transfer.hash,
    previousOwner: alice, currentOwner: bob,
    previousOwnerRejected: true, newOwnerCanUpdate: true,
    identityCustodyPreserved: true, historyMetadataPreserved: true, agentWallet: ZeroAddress,
  };
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/local-demo.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log("PASS: ownership moved to B; A lost management access; identity and metadata persisted.");
} finally { await f.connection.close(); }
