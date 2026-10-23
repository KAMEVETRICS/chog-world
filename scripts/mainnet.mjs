import { AbiCoder, Contract, ContractFactory, formatEther, getAddress, keccak256 } from "ethers";
import { loadArtifact } from "./artifacts.mjs";
import { inspectCollection } from "./collection-check.mjs";
import { TOKENBOUND } from "./deployment-config.mjs";
import { prepareDeployment } from "./deploy-contract.mjs";

// Pinned Monad mainnet dependencies. The registry implementation is the one reviewed on 2026-10-19;
// if its owner upgrades it, deployment stops until the new implementation is reviewed and pinned.
export const MAINNET = Object.freeze({
  chainId: 143,
  genesis: "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763",
  identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  registryImplementation: getAddress("0x7274e874ca62410a93bd8bf61c69d8045e399c02"),
  registryVersion: "2.0.0",
  tokenbound: TOKENBOUND,
});
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
// Some public RPCs reject eth_call's default gas allowance; bound read-only calls explicitly.
const READ = { gasLimit: 100_000n };

export function mainnetConfig(env = process.env) {
  const rpcUrl = env.MONAD_MAINNET_RPC_URL || "https://rpc.monad.xyz";
  let parsed;
  try { parsed = new URL(rpcUrl); } catch { throw new Error("MONAD_MAINNET_RPC_URL must be an HTTPS URL."); }
  if (parsed.protocol !== "https:") throw new Error("MONAD_MAINNET_RPC_URL must use HTTPS.");
  return { ...MAINNET, rpcUrl };
}

export function adapterConstructorArgs(config = MAINNET) {
  return [config.genesis, config.identityRegistry, config.tokenbound.registry, config.tokenbound.implementation, config.tokenbound.salt];
}

export function mainnetPlan(config = MAINNET) {
  const adapter = loadArtifact("ChogAdapter");
  const args = adapterConstructorArgs(config);
  return {
    network: "Monad mainnet",
    chainId: config.chainId,
    broadcast: false,
    compiler: adapter.compiler,
    adapterInitCodeHash: initCodeHash(adapter, args),
    actions: [{
      contract: "ChogAdapter",
      constructor: { collection: args[0], identityRegistry: args[1], accountRegistry: args[2], accountImplementation: args[3], accountSalt: args[4] },
    }],
    pinnedRegistryImplementation: config.registryImplementation,
    next: "Run --preflight (no signing) to get a confirmation code, then --broadcast --confirm <code>.",
  };
}

function initCodeHash(artifact, args) {
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  return keccak256(factory.bytecode + factory.interface.encodeDeploy(args).slice(2));
}

/// Read-only checks that every pinned dependency on chain 143 is what the adapter was reviewed against.
export async function checkMainnetDependencies(provider, config = MAINNET) {
  const { chainId } = await provider.getNetwork();
  if (chainId !== BigInt(config.chainId)) throw new Error(`Mainnet deployment requires chain ${config.chainId}; the RPC reports ${chainId}.`);
  const genesis = await inspectCollection(provider, config.genesis, { chainId: config.chainId });

  if (await provider.getCode(config.identityRegistry) === "0x") throw new Error("The ERC-8004 identity registry has no code on Monad mainnet.");
  const registry = new Contract(config.identityRegistry, [
    "function supportsInterface(bytes4) view returns (bool)", "function getVersion() view returns (string)",
  ], provider);
  if (!await registry.supportsInterface("0x80ac58cd", READ)) throw new Error("The identity registry does not support ERC-721.");
  const version = await registry.getVersion(READ);
  if (version !== config.registryVersion) throw new Error(`Identity registry version is ${version}; the adapter was reviewed against ${config.registryVersion}.`);
  const slot = await provider.getStorage(config.identityRegistry, IMPLEMENTATION_SLOT);
  const implementation = getAddress(`0x${slot.slice(-40)}`);
  if (implementation !== config.registryImplementation) {
    throw new Error(`The identity registry was upgraded to ${implementation}; review it and update the pinned implementation before deploying.`);
  }

  for (const [label, address] of [["Tokenbound registry", config.tokenbound.registry], ["Tokenbound account implementation", config.tokenbound.implementation]]) {
    if (await provider.getCode(address) === "0x") throw new Error(`The ${label} ${address} has no code on Monad mainnet.`);
  }
  const tokenbound = new Contract(config.tokenbound.registry, ["function account(address,bytes32,uint256,address,uint256) view returns (address)"], provider);
  const sampleAccount = await tokenbound.account(config.tokenbound.implementation, config.tokenbound.salt, config.chainId, config.genesis, 1n, READ);
  return { genesis, registryVersion: version, registryImplementation: implementation, sampleTokenAccount: { tokenId: "1", account: sampleAccount } };
}

/// The confirmation code binds a broadcast to exactly what preflight showed: chain, deployer, nonce and init code.
export function confirmationCode({ chainId, deployer, nonce, initCodeHash: hash }) {
  const digest = keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256", "bytes32"], [chainId, deployer, nonce, hash]));
  return `CHOG-${digest.slice(2, 10).toUpperCase()}`;
}

/// Unsigned preparation: estimate, nonce, fees, funding, and the exact runtime code the constructor returns on mainnet state.
export async function prepareMainnetAdapter(provider, signer, config = MAINNET) {
  const adapter = loadArtifact("ChogAdapter");
  const args = adapterConstructorArgs(config);
  const deployer = await signer.getAddress();
  const factory = new ContractFactory(adapter.abi, adapter.bytecode, signer);
  const prepared = await prepareDeployment(factory, args);
  const hash = keccak256(prepared.data);
  if (hash !== initCodeHash(adapter, args)) throw new Error("Prepared init code does not match the compiled adapter and constructor arguments.");
  // Simulating the creation returns the runtime code; this also proves the constructor accepts the live dependencies.
  const expectedRuntime = await provider.call({ from: deployer, data: prepared.data, gasLimit: prepared.gasLimit });
  if (!expectedRuntime || expectedRuntime === "0x") throw new Error("Simulating the adapter constructor on mainnet returned no code.");
  const balance = await provider.getBalance(deployer);
  const maxFee = prepared.maxFeePerGas ?? prepared.gasPrice;
  // Monad charges the full gas limit, so budget gasLimit * maxFee.
  const maxCost = prepared.gasLimit * maxFee;
  if (balance < maxCost) {
    throw Object.assign(new Error(`The deployer needs at least ${formatEther(maxCost)} MON for this deployment; it has ${formatEther(balance)} MON. No transaction was sent.`), { code: "PREFLIGHT_REJECTED" });
  }
  const code = confirmationCode({ chainId: config.chainId, deployer, nonce: prepared.nonce, initCodeHash: hash });
  return { prepared, deployer, nonce: prepared.nonce, initCodeHash: hash, expectedRuntime, gasLimit: prepared.gasLimit, maxFeePerGas: maxFee, maxCost, balance, confirmation: code };
}

/// Read-only post-deployment check: exact runtime code and every immutable.
export async function verifyDeployedAdapter(provider, address, { expectedRuntime, config = MAINNET } = {}) {
  const live = await provider.getCode(address);
  if (live === "0x") throw new Error(`No code at ${address}.`);
  let runtime = expectedRuntime;
  if (!runtime) {
    const adapter = loadArtifact("ChogAdapter");
    const factory = new ContractFactory(adapter.abi, adapter.bytecode);
    runtime = await provider.call({ data: (await factory.getDeployTransaction(...adapterConstructorArgs(config))).data, gasLimit: 8_000_000n });
  }
  if (live.toLowerCase() !== runtime.toLowerCase()) throw new Error(`Runtime code at ${address} does not match the compiled adapter with the mainnet constructor arguments.`);
  const adapter = new Contract(address, loadArtifact("ChogAdapter").abi, provider);
  const expected = adapterConstructorArgs(config);
  const actual = [
    await adapter.collection(READ), await adapter.identityRegistry(READ), await adapter.accountRegistry(READ),
    await adapter.accountImplementation(READ), await adapter.accountSalt(READ),
  ];
  for (const [index, value] of actual.entries()) {
    if (String(value).toLowerCase() !== String(expected[index]).toLowerCase()) throw new Error(`Adapter immutable ${index} is ${value}; expected ${expected[index]}.`);
  }
  return { address, runtimeCodeHash: keccak256(live), runtimeMatches: true, immutables: actual };
}
