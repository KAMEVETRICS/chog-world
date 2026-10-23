// A local EVM for live-reader tests: Hardhat's in-process EDR chain from the repository root, served
// over plain HTTP JSON-RPC so the reader uses its real transport. Deploys the real compiled ChogAdapter,
// the vendored ERC-8004 IdentityRegistry and the TestChog fixture from ../artifacts/compiled.json.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { BrowserProvider, Contract, ContractFactory, Interface, ZeroAddress, ZeroHash, keccak256, type Eip1193Provider, type JsonRpcSigner } from "ethers";
import type { DeploymentManifest } from "../../src/chain/manifest.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COMPILED = new URL("../../../artifacts/compiled.json", import.meta.url);

interface HardhatConnection { readonly provider: Eip1193Provider & { request(args: { method: string; params?: unknown[] }): Promise<unknown> }; close(): Promise<void> }
interface HardhatHre { readonly network: { create(name: string): Promise<HardhatConnection> } }

function artifacts() {
  if (!fs.existsSync(COMPILED) || !fs.existsSync(new URL("../../../node_modules/hardhat/package.json", import.meta.url))) {
    throw new Error("The local-EVM test needs the repository root's Hardhat and compiled contracts: run npm.cmd install and npm.cmd run compile in the root first.");
  }
  const compiled = JSON.parse(fs.readFileSync(COMPILED, "utf8")) as { contracts: Record<string, Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>> };
  return (name: string) => {
    const matches = Object.entries(compiled.contracts).flatMap(([file, contracts]) => Object.entries(contracts)
      .filter(([contract]) => name === contract || name === `${file}:${contract}`).map(([, result]) => result));
    if (matches.length !== 1) throw new Error(`Expected one compiled contract named ${name}; found ${matches.length}.`);
    return { abi: matches[0]!.abi as never[], bytecode: `0x${matches[0]!.evm.bytecode.object}` };
  };
}

export interface LocalEvm {
  readonly url: string;
  readonly provider: BrowserProvider;
  readonly request: (method: string, params?: unknown[]) => Promise<unknown>;
  readonly signers: readonly JsonRpcSigner[];
  readonly collection: Contract;
  readonly registry: Contract;
  readonly adapter: Contract;
  readonly manifest: DeploymentManifest;
  close(): Promise<void>;
}

/** Starts a fresh chain 143, mints `preMinted` tokens to signer 0, then deploys the adapter. */
export async function startLocalEvm(preMinted: readonly bigint[]): Promise<LocalEvm> {
  const artifact = artifacts();
  // A variable specifier keeps Hardhat's types out of this package's typecheck.
  const specifier = "hardhat/hre";
  const { createHardhatRuntimeEnvironment } = await import(specifier) as { createHardhatRuntimeEnvironment(config: unknown, options: object, root: string): Promise<HardhatHre> };
  const hre = await createHardhatRuntimeEnvironment({
    chainDescriptors: { 143: { name: "Monad", chainType: "l1", hardforkHistory: { prague: { blockNumber: 0 } } } },
    networks: { local: { type: "edr-simulated", chainType: "l1", chainId: 143, hardfork: "prague" } },
  }, {}, ROOT);
  const connection = await hre.network.create("local");
  const request = (method: string, params: unknown[] = []) => connection.provider.request({ method, params });

  const server = http.createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: number; method: string; params: unknown[] };
      let reply: object;
      try { reply = { jsonrpc: "2.0", id: body.id, result: await request(body.method, body.params) }; }
      catch (error) {
        const { code, message, data } = error as { code?: number; message?: string; data?: unknown };
        reply = { jsonrpc: "2.0", id: body.id, error: { code: code ?? -32603, message: message ?? "error", ...(data === undefined ? {} : { data }) } };
      }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const provider = new BrowserProvider(connection.provider);
  provider.pollingInterval = 10;
  const signers = await Promise.all([0, 1, 2, 3].map((index) => provider.getSigner(index)));
  const owner = signers[0]!;
  const deploy = async (name: string, args: unknown[] = []) => {
    const { abi, bytecode } = artifact(name);
    const contract = await new ContractFactory(abi, bytecode, owner).deploy(...args);
    await contract.waitForDeployment();
    return contract as Contract;
  };

  const collection = await deploy("TestChog");
  for (const tokenId of preMinted) await (await collection.getFunction("mint")(await owner.getAddress(), tokenId)).wait();

  // The vendored ERC-8004 registry behind its proxy, as in the root tests.
  const bootstrap = await deploy("HardhatMinimalUUPS");
  const proxy = await deploy("contracts/vendor/erc8004/ERC1967Proxy.sol:ERC1967Proxy", [await bootstrap.getAddress(), bootstrap.interface.encodeFunctionData("initialize", [ZeroAddress])]);
  const implementation = await deploy("IdentityRegistryUpgradeable");
  const registryAbi = artifact("IdentityRegistryUpgradeable").abi;
  await (await new Contract(await proxy.getAddress(), artifact("HardhatMinimalUUPS").abi, owner).getFunction("upgradeToAndCall")(await implementation.getAddress(), new Interface(registryAbi).encodeFunctionData("initialize"))).wait();
  const registry = new Contract(await proxy.getAddress(), registryAbi, owner);
  const accountRegistry = await deploy("TestERC6551Registry");
  const accountImplementation = await deploy("TestTokenAccount");

  const { abi, bytecode } = artifact("ChogAdapter");
  const adapter = await new ContractFactory(abi, bytecode, owner).deploy(
    await collection.getAddress(), await registry.getAddress(), await accountRegistry.getAddress(), await accountImplementation.getAddress(), ZeroHash) as Contract;
  const receipt = (await adapter.deploymentTransaction()!.wait())!;
  const code = await provider.getCode(await adapter.getAddress());
  const manifest: DeploymentManifest = {
    environment: "local-evm", chainId: 143, registry: (await registry.getAddress()).toLowerCase(), adapter: (await adapter.getAddress()).toLowerCase(),
    collection: (await collection.getAddress()).toLowerCase(), activationBlock: String(receipt.blockNumber), activationBlockHash: receipt.blockHash.toLowerCase(),
    receipts: { adapterDeployment: receipt.hash.toLowerCase() }, runtimeCodeHashes: { adapter: keccak256(code) },
  };

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, provider, request, signers, collection, registry, adapter, manifest,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await connection.close();
    },
  };
}
