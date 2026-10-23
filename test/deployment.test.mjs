import assert from "node:assert/strict";
import { test } from "node:test";
import { AbiCoder } from "ethers";

test("deployment planning defaults to a labelled test NFT and never reads a private key", async () => {
  const { deploymentConfig, deploymentPlan } = await import("../scripts/deployment-config.mjs");
  const env = new Proxy({}, { get(_target, key) {
    assert.notEqual(key, "DEPLOYER_PRIVATE_KEY", "planning must not request a signing key");
    return undefined;
  } });
  const plan = deploymentPlan(deploymentConfig(env));
  assert.equal(plan.chainId, 10143);
  assert.equal(plan.registry, "0x8004A818BFB912233c491871b3d84c89A494BD9e");
  assert.deepEqual(plan.actions.map((action) => action.contract), ["TestChog", "ChogAdapter"]);
  assert.equal(plan.broadcast, false);
  assert.equal(plan.officialChogCollection, false);
});

test("deployment configuration accepts an explicit test collection and rejects invalid addresses", async () => {
  const { deploymentConfig, deploymentPlan } = await import("../scripts/deployment-config.mjs");
  for (const address of ["not-an-address", "0x0000000000000000000000000000000000000000"]) {
    assert.throws(() => deploymentConfig({ CHOG_COLLECTION_ADDRESS: address }), /collection/i);
  }
  const config = deploymentConfig({ CHOG_COLLECTION_ADDRESS: "0x1414f3BAF22404C42fD656af4aFAab4934045137" });
  assert.deepEqual(deploymentPlan(config).actions.map((action) => action.contract), ["ChogAdapter"]);
});

test("public deployment preflight rejects mainnet or missing registry code before signing", async () => {
  const { deploymentConfig, validateNetwork } = await import("../scripts/deployment-config.mjs");
  const config = deploymentConfig({});
  await assert.rejects(validateNetwork({ getNetwork: async () => ({ chainId: 143n }) }, config), /10143/);
  await assert.rejects(validateNetwork({ getNetwork: async () => ({ chainId: 10143n }), getCode: async () => "0x" }, config), /registry/i);
});

test("public deployment preflight bounds ERC721 calls for RPCs with a gas cap", async () => {
  const { deploymentConfig, validateNetwork } = await import("../scripts/deployment-config.mjs");
  const config = deploymentConfig({ CHOG_COLLECTION_ADDRESS: "0x1414f3BAF22404C42fD656af4aFAab4934045137" });
  const checked = [];
  const provider = {
    getNetwork: async () => ({ chainId: 10143n }),
    getCode: async () => "0x01",
    call: async (transaction) => {
      if (transaction.gasLimit === undefined || transaction.gasLimit > 100_000n) {
        throw new Error("user-specified gas exceeds provider limit");
      }
      checked.push(transaction.to);
      assert.ok(transaction.data.startsWith("0x01ffc9a7"));
      return AbiCoder.defaultAbiCoder().encode(["bool"], [true]);
    },
  };
  await validateNetwork(provider, config);
  assert.deepEqual(checked, [config.registry, config.collection]);
});
