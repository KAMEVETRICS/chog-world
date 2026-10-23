import assert from "node:assert/strict";
import fs from "node:fs";
import hre from "hardhat";
import { BrowserProvider, Contract, ContractFactory, Interface, ZeroAddress, ZeroHash } from "ethers";

const compiled = JSON.parse(fs.readFileSync(new URL("../artifacts/compiled.json", import.meta.url)));

export function artifact(name) {
  const matches = Object.entries(compiled.contracts).flatMap(([filename, contracts]) =>
    Object.entries(contracts).filter(([contractName]) => name === contractName || name === `${filename}:${contractName}`)
      .map(([, result]) => result));
  assert.equal(matches.length, 1, `Expected one compiled contract named ${name}; found ${matches.length}`);
  return { abi: matches[0].abi, bytecode: `0x${matches[0].evm.bytecode.object}` };
}

export async function deploy(name, signer, args = []) {
  const { abi, bytecode } = artifact(name);
  const contract = await new ContractFactory(abi, bytecode, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

export async function localChain() {
  const connection = await hre.network.create("local");
  const provider = new BrowserProvider(connection.provider);
  provider.pollingInterval = 10;
  const signers = await Promise.all([0, 1, 2, 3].map((index) => provider.getSigner(index)));
  return { connection, provider, signers };
}

export async function registryFixture(signer) {
  const bootstrap = await deploy("HardhatMinimalUUPS", signer);
  const init = bootstrap.interface.encodeFunctionData("initialize", [ZeroAddress]);
  const proxy = await deploy("contracts/vendor/erc8004/ERC1967Proxy.sol:ERC1967Proxy", signer, [await bootstrap.getAddress(), init]);
  const implementation = await deploy("IdentityRegistryUpgradeable", signer);
  const registryABI = artifact("IdentityRegistryUpgradeable").abi;
  const data = new Interface(registryABI).encodeFunctionData("initialize");
  const bootstrapProxy = new Contract(await proxy.getAddress(), artifact("HardhatMinimalUUPS").abi, signer);
  await (await bootstrapProxy.upgradeToAndCall(await implementation.getAddress(), data)).wait();
  return new Contract(await proxy.getAddress(), registryABI, signer);
}

export async function tokenAccounts(signer) {
  const registry = await deploy("TestERC6551Registry", signer);
  const implementation = await deploy("TestTokenAccount", signer);
  return { registry, implementation, salt: ZeroHash };
}

export async function adapterArgs(collection, identityRegistry, accounts) {
  return [await collection.getAddress(), await identityRegistry.getAddress(), await accounts.registry.getAddress(), await accounts.implementation.getAddress(), accounts.salt];
}

export async function validationRegistryFixture(signer, identityRegistry) {
  const bootstrap = await deploy("HardhatMinimalUUPS", signer);
  const init = bootstrap.interface.encodeFunctionData("initialize", [await identityRegistry.getAddress()]);
  const proxy = await deploy("contracts/vendor/erc8004/ERC1967Proxy.sol:ERC1967Proxy", signer, [await bootstrap.getAddress(), init]);
  const implementation = await deploy("ValidationRegistryUpgradeable", signer);
  const abi = artifact("ValidationRegistryUpgradeable").abi;
  const data = new Interface(abi).encodeFunctionData("initialize", [await identityRegistry.getAddress()]);
  const bootstrapProxy = new Contract(await proxy.getAddress(), artifact("HardhatMinimalUUPS").abi, signer);
  await (await bootstrapProxy.upgradeToAndCall(await implementation.getAddress(), data)).wait();
  return new Contract(await proxy.getAddress(), abi, signer);
}

export async function fixture() {
  const chain = await localChain();
  const [alice, bob, outsider, operator] = chain.signers;
  const collection = await deploy("TestChog", alice);
  const registry = await registryFixture(alice);
  const accounts = await tokenAccounts(alice);
  const adapter = await deploy("ChogAdapter", alice, await adapterArgs(collection, registry, accounts));
  return { ...chain, alice, bob, outsider, operator, collection, registry, accounts, adapter };
}

export async function reverted(action, contract, errorName) {
  await assert.rejects(action, (error) => {
    // ethers sometimes cannot coalesce Hardhat's error, leaving the revert data only in the nested message.
    const data = error.data ?? error.info?.error?.data?.data ?? error.info?.error?.data
      ?? String(error.error?.message ?? "").match(/return data: (0x[0-9a-f]*)/i)?.[1];
    let parsed;
    try { parsed = contract.interface.parseError(typeof data === "string" ? data : data?.data); } catch {}
    assert.equal(parsed?.name, errorName, `Expected ${errorName}; received ${error.shortMessage ?? error.message}`);
    return true;
  });
}
