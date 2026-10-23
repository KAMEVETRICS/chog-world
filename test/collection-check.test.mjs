import assert from "node:assert/strict";
import { test } from "node:test";
import { AbiCoder } from "ethers";
import { deploy, localChain } from "./helpers.mjs";

test("collection inspection bounds both interface and optional name calls for capped RPCs", async () => {
  const { inspectCollection } = await import("../scripts/collection-check.mjs");
  const address = "0x1414f3BAF22404C42fD656af4aFAab4934045137";
  const blockTag = 147;
  const checked = [];
  const provider = {
    getCode: async (_address, block) => { assert.equal(block, blockTag); return "0x01"; },
    call: async (transaction) => {
      if (transaction.gasLimit === undefined || transaction.gasLimit > 100_000n) {
        throw new Error("user-specified gas exceeds provider limit");
      }
      assert.equal(transaction.blockTag, blockTag);
      checked.push(transaction.data.slice(0, 10));
      return transaction.data === "0x06fdde03"
        ? AbiCoder.defaultAbiCoder().encode(["string"], ["Test collection"])
        : AbiCoder.defaultAbiCoder().encode(["bool"], [true]);
    },
  };
  const result = await inspectCollection(provider, address, { chainId: 10143, blockTag });
  assert.equal(result.erc721, true);
  assert.equal(result.collectionName, "Test collection");
  assert.deepEqual(checked, ["0x01ffc9a7", "0x06fdde03"]);
});

test("a local-only address reports missing collection code before ABI decoding", async (t) => {
  const { inspectCollection } = await import("../scripts/collection-check.mjs");
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const address = await chain.signers[1].getAddress();
  let calls = 0;
  const runner = {
    getCode: chain.provider.getCode.bind(chain.provider),
    call: (...args) => { calls++; return chain.provider.call(...args); },
  };
  await assert.rejects(inspectCollection(runner, address, { chainId: 10143 }), (error) => {
    assert.match(error.message, /no deployed code/i);
    assert.match(error.message, /10143/);
    assert.ok(error.message.includes(address));
    assert.match(error.message, /CHOG_COLLECTION_ADDRESS/);
    return true;
  });
  assert.equal(calls, 0, "an address without code must not receive ABI calls");
});

test("a real collection returns name and ERC721 support at the selected block", async (t) => {
  const { inspectCollection } = await import("../scripts/collection-check.mjs");
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const collection = await deploy("TestChog", chain.signers[0]);
  const blockTag = (await collection.deploymentTransaction().wait()).blockNumber;
  const result = await inspectCollection(chain.provider, await collection.getAddress(), { chainId: 31337, blockTag });
  assert.equal(result.collectionName, "Chog Awakening Test NFT");
  assert.equal(result.erc721, true);
  assert.ok(result.collectionCodeBytes > 0);
});

test("a valid ERC721 still passes when its optional name call is unavailable", async (t) => {
  const { inspectCollection } = await import("../scripts/collection-check.mjs");
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const collection = await deploy("TestChog", chain.signers[0]);
  const runner = {
    getCode: chain.provider.getCode.bind(chain.provider),
    call: (transaction) => transaction.data === "0x06fdde03"
      ? Promise.reject(new Error("optional name() unavailable")) : chain.provider.call(transaction),
  };
  const result = await inspectCollection(runner, await collection.getAddress(), { chainId: 31337 });
  assert.equal(result.erc721, true);
  assert.equal(result.collectionName, null);
});

test("a deployed contract without ERC721 support reports a clear interface error", async (t) => {
  const { inspectCollection } = await import("../scripts/collection-check.mjs");
  const chain = await localChain();
  t.after(() => chain.connection.close());
  const nonNFT = await deploy("HardhatMinimalUUPS", chain.signers[0]);
  await assert.rejects(inspectCollection(chain.provider, await nonNFT.getAddress(), { chainId: 31337 }), /ERC-721/);
});
