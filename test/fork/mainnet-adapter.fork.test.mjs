// Mainnet-fork test: the new ChogAdapter against the real Chog Genesis, ERC-8004 IdentityRegistry and
// Tokenbound contracts on Monad mainnet. Runs in a local fork; nothing is signed for or sent to Monad.
import assert from "node:assert/strict";
import { test } from "node:test";
import hre from "hardhat";
import { BrowserProvider, Contract, JsonRpcSigner, Wallet, ZeroAddress, getAddress, id, parseEther, toBeHex } from "ethers";
import { artifact, deploy, reverted, validationRegistryFixture } from "../helpers.mjs";
import { TOKENBOUND } from "../../scripts/deployment-config.mjs";

const GENESIS = "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763";
const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const ACCOUNT_V3 = "0x41C8f39463A868d3A88af00cd0fe7102F30E44eC";
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const genesisABI = ["function ownerOf(uint256) view returns (address)", "function transferFrom(address,address,uint256)"];
const tokenboundRegistryABI = [
  "function createAccount(address,bytes32,uint256,address,uint256) returns (address)",
  "function account(address,bytes32,uint256,address,uint256) view returns (address)",
];
const tokenAccountABI = ["function initialize(address)", "function owner() view returns (address)", "function token() view returns (uint256,address,uint256)"];

async function fundedWallet(provider) {
  const wallet = Wallet.createRandom().connect(provider);
  await provider.send("hardhat_setBalance", [wallet.address, toBeHex(parseEther("10"))]);
  return wallet;
}

// A holder whose Chog is in an EOA, so impersonation can move it to a test key that can sign.
async function eoaHolder(provider, genesis) {
  for (let tokenId = 1n; tokenId <= 60n; tokenId++) {
    const holder = await genesis.ownerOf(tokenId);
    if (await provider.getCode(holder) === "0x") return { tokenId, holder };
  }
  throw new Error("No EOA-held Chog Genesis token found in the first 60 IDs.");
}

async function walletSignature(signer, registry, chainId, adapter, agentId, newWallet, deadline) {
  const domain = { name: "ERC8004IdentityRegistry", version: "1", chainId, verifyingContract: registry };
  const types = { AgentWalletSet: [
    { name: "agentId", type: "uint256" }, { name: "newWallet", type: "address" },
    { name: "owner", type: "address" }, { name: "deadline", type: "uint256" },
  ] };
  return signer.signTypedData(domain, types, { agentId, newWallet, owner: adapter, deadline });
}

test("mainnet fork: awaken a real Chog, bind its Tokenbound wallet, follow a sale and request validation", { timeout: 600_000 }, async (t) => {
  const connection = await hre.network.create("monadFork");
  t.after(() => connection.close());
  // Locally signed test wallets send back-to-back transactions; cached nonce reads would go stale.
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const { chainId } = await provider.getNetwork();
  assert.equal(chainId, 143n);
  for (const address of [GENESIS, IDENTITY_REGISTRY, TOKENBOUND.registry, TOKENBOUND.implementation, ACCOUNT_V3]) {
    assert.notEqual(await provider.getCode(address), "0x", `${address} must exist on the fork`);
  }

  const deployer = await provider.getSigner(0);
  const adapter = await deploy("ChogAdapter", deployer, [GENESIS, IDENTITY_REGISTRY, TOKENBOUND.registry, TOKENBOUND.implementation, TOKENBOUND.salt]);
  const adapterAddress = await adapter.getAddress();
  const registry = new Contract(IDENTITY_REGISTRY, artifact("IdentityRegistryUpgradeable").abi, provider);
  const genesis = new Contract(GENESIS, genesisABI, provider);
  assert.equal(await registry.getVersion(), "2.0.0");

  const { tokenId, holder } = await eoaHolder(provider, genesis);
  const alice = await fundedWallet(provider);
  const bob = await fundedWallet(provider);
  await provider.send("hardhat_impersonateAccount", [holder]);
  await provider.send("hardhat_setBalance", [holder, toBeHex(parseEther("10"))]);
  await (await genesis.connect(new JsonRpcSigner(provider, holder)).transferFrom(holder, alice.address, tokenId)).wait();
  await provider.send("hardhat_stopImpersonatingAccount", [holder]);

  // Awakening registers through the real registry, and the adapter keeps custody of the identity.
  await (await adapter.connect(alice).awaken(tokenId, "ipfs://fork-chog")).wait();
  const agentId = await adapter.agentOf(tokenId);
  assert.equal(await registry.ownerOf(agentId), adapterAddress);
  assert.equal(await registry.getMetadata(agentId, "agent-binding"), adapterAddress.toLowerCase());
  assert.equal(await registry.getAgentWallet(agentId), ZeroAddress);
  assert.equal(await adapter.controllerOf(agentId), alice.address);

  // The adapter derives the same account address as the canonical Tokenbound registry and SDK defaults.
  const tokenbound = new Contract(TOKENBOUND.registry, tokenboundRegistryABI, alice);
  const account = await adapter.tokenAccountOf(tokenId);
  assert.equal(account, await tokenbound.account(TOKENBOUND.implementation, TOKENBOUND.salt, chainId, GENESIS, tokenId));
  const deadline = BigInt((await provider.getBlock("latest")).timestamp) + 120n;
  const aliceSignature = await walletSignature(alice, IDENTITY_REGISTRY, chainId, adapterAddress, agentId, account, deadline);
  if (await provider.getCode(account) === "0x") {
    await reverted(adapter.connect(alice).setAgentWallet(agentId, deadline, aliceSignature), adapter, "TokenAccountNotDeployed");
    await (await tokenbound.createAccount(TOKENBOUND.implementation, TOKENBOUND.salt, chainId, GENESIS, tokenId)).wait();
  }
  const tokenAccount = new Contract(account, tokenAccountABI, alice);
  if (BigInt(await provider.getStorage(account, IMPLEMENTATION_SLOT)) === 0n) await (await tokenAccount.initialize(ACCOUNT_V3)).wait();
  assert.equal(getAddress(toBeHex(await provider.getStorage(account, IMPLEMENTATION_SLOT), 20)), ACCOUNT_V3);
  assert.equal(await tokenAccount.owner(), alice.address);

  // Real AccountV3 accepts the holder's EOA signature for the real registry's digest through ERC-1271.
  await (await adapter.connect(alice).setAgentWallet(agentId, deadline, aliceSignature)).wait();
  assert.equal(await registry.getAgentWallet(agentId), account);

  // A sale moves control of both the agent and its wallet, with no clean-up transaction.
  await (await genesis.connect(alice).transferFrom(alice.address, bob.address, tokenId)).wait();
  assert.equal(await adapter.controllerOf(agentId), bob.address);
  assert.equal(await tokenAccount.owner(), bob.address);
  assert.equal(await registry.getAgentWallet(agentId), account);
  await reverted(adapter.connect(alice).setAgentWallet(agentId, deadline, aliceSignature), adapter, "NotTokenOwner");
  await reverted(adapter.connect(alice).unsetAgentWallet(agentId), adapter, "NotTokenOwner");
  await assert.rejects(adapter.connect(bob).setAgentWallet(agentId, deadline, aliceSignature), /invalid wallet sig|reverted/);
  await (await adapter.connect(bob).unsetAgentWallet(agentId)).wait();
  assert.equal(await registry.getAgentWallet(agentId), ZeroAddress);
  const bobSignature = await walletSignature(bob, IDENTITY_REGISTRY, chainId, adapterAddress, agentId, account, deadline);
  await (await adapter.connect(bob).setAgentWallet(agentId, deadline, bobSignature)).wait();
  assert.equal(await registry.getAgentWallet(agentId), account);

  // No ValidationRegistry is deployed on Monad mainnet; deploy the pinned upstream one bound to the real identity registry.
  const validation = await validationRegistryFixture(deployer, registry);
  const requestHash = id(`chog-fork-validation-${tokenId}`);
  await reverted(adapter.connect(alice).requestValidation(await validation.getAddress(), alice.address, agentId, "ipfs://req", requestHash), adapter, "NotTokenOwner");
  await (await adapter.connect(bob).requestValidation(await validation.getAddress(), alice.address, agentId, "ipfs://req", requestHash)).wait();
  const status = await validation.getValidationStatus(requestHash);
  assert.equal(status[0], alice.address);
  assert.equal(status[1], agentId);
  assert.equal(await registry.ownerOf(agentId), adapterAddress, "identity custody never leaves the adapter");
  console.log(`fork block ${await provider.getBlockNumber()}; Chog #${tokenId}; agent ${agentId}; account ${account}`);
});

test("mainnet fork: the deploy path preflights, deploys with a confirmation code and verifies exact runtime code", { timeout: 600_000 }, async (t) => {
  const { MAINNET, checkMainnetDependencies, confirmationCode, prepareMainnetAdapter, verifyDeployedAdapter } = await import("../../scripts/mainnet.mjs");
  const { deployAndRecord } = await import("../../scripts/deploy-contract.mjs");
  const connection = await hre.network.create("monadFork");
  t.after(() => connection.close());
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;

  const dependencies = await checkMainnetDependencies(provider);
  assert.equal(dependencies.registryImplementation, MAINNET.registryImplementation);
  assert.equal(dependencies.registryVersion, "2.0.0");

  const unfunded = Wallet.createRandom().connect(provider);
  await assert.rejects(prepareMainnetAdapter(provider, unfunded), /needs at least/);
  const deployer = await fundedWallet(provider);
  const plan = await prepareMainnetAdapter(provider, deployer);
  assert.equal(plan.confirmation, confirmationCode({ chainId: 143, deployer: deployer.address, nonce: 0, initCodeHash: plan.initCodeHash }));

  const states = [];
  const artifactABI = artifact("ChogAdapter");
  const factory = new (await import("ethers")).ContractFactory(artifactABI.abi, artifactABI.bytecode, deployer);
  const deployed = await deployAndRecord(factory, [], (record) => states.push(record.status), { prepared: plan.prepared });
  assert.deepEqual(states, ["prepared", "pending", "confirmed"]);
  const verification = await verifyDeployedAdapter(provider, deployed.address, { expectedRuntime: plan.expectedRuntime });
  assert.equal(verification.runtimeMatches, true);
  // Without the preflight runtime, --check recomputes it from live mainnet state.
  assert.equal((await verifyDeployedAdapter(provider, deployed.address)).runtimeCodeHash, verification.runtimeCodeHash);

  // A different adapter build (another salt) at a known address must fail verification.
  const other = await deploy("ChogAdapter", deployer, [GENESIS, IDENTITY_REGISTRY, TOKENBOUND.registry, TOKENBOUND.implementation, id("other-salt")]);
  await assert.rejects(verifyDeployedAdapter(provider, await other.getAddress()), /does not match/);
  await assert.rejects(verifyDeployedAdapter(provider, deployer.address), /No code/);
});
