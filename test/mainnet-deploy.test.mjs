import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import solc from "solc";
import { Interface, Wallet, ZeroHash, keccak256 } from "ethers";
import { MAINNET, adapterConstructorArgs, checkMainnetDependencies, confirmationCode, mainnetConfig, mainnetPlan } from "../scripts/mainnet.mjs";
import { mainnetSigner, parseArgs } from "../scripts/deploy-mainnet.mjs";
import { adapterStandardJson, constructorArgumentsHex, readRecord } from "../scripts/verify-source.mjs";
import { artifact } from "./helpers.mjs";

// Public Hardhat test keys; never funded on Monad.
const KEY_A = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEY_B = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

test("mainnet CLI defaults to an offline plan and needs a matching-format confirmation to broadcast", () => {
  assert.deepEqual(parseArgs([]), { mode: "plan", confirm: undefined });
  assert.equal(parseArgs(["--preflight"]).mode, "preflight");
  assert.deepEqual(parseArgs(["--broadcast", "--confirm", "CHOG-0A1B2C3D"]), { mode: "broadcast", confirm: "CHOG-0A1B2C3D" });
  for (const argv of [["--broadcast"], ["--broadcast", "--confirm", "yes"], ["--broadcast", "--confirm", "CHOG-0a1b2c3d"]]) {
    assert.throws(() => parseArgs(argv), /--confirm CHOG-XXXXXXXX/);
  }
  assert.throws(() => parseArgs(["--preflight", "--broadcast", "--confirm", "CHOG-0A1B2C3D"]), /Choose one/);
  assert.throws(() => parseArgs(["--preflight", "--confirm", "CHOG-0A1B2C3D"]), /only used with --broadcast/);
  assert.throws(() => parseArgs(["--check", "nope"]), /adapter address/);
  assert.equal(parseArgs(["--check", MAINNET.genesis.toLowerCase()]).address, MAINNET.genesis);
});

test("the mainnet signer is separate from the testnet key and preflight can run from an address alone", () => {
  const a = new Wallet(KEY_A).address;
  assert.throws(() => mainnetSigner({}, { needKey: true }), /MAINNET_DEPLOYER_PRIVATE_KEY/);
  assert.throws(() => mainnetSigner({}, { needKey: false }), /MAINNET_DEPLOYER_ADDRESS/);
  assert.deepEqual(mainnetSigner({ MAINNET_DEPLOYER_ADDRESS: a.toLowerCase() }, { needKey: false }), { address: a, wallet: null });
  assert.throws(() => mainnetSigner({ MAINNET_DEPLOYER_PRIVATE_KEY: KEY_A, DEPLOYER_PRIVATE_KEY: KEY_A }, { needKey: true }), /must not reuse the testnet/);
  assert.throws(() => mainnetSigner({ MAINNET_DEPLOYER_PRIVATE_KEY: KEY_A, MAINNET_DEPLOYER_ADDRESS: new Wallet(KEY_B).address }, { needKey: true }), /does not match/);
  assert.throws(() => mainnetSigner({ MAINNET_DEPLOYER_PRIVATE_KEY: "0x1234" }, { needKey: true }), /not a valid signing key/);
  assert.equal(mainnetSigner({ MAINNET_DEPLOYER_PRIVATE_KEY: KEY_A, DEPLOYER_PRIVATE_KEY: KEY_B }, { needKey: true }).address, a);
});

test("the mainnet plan deploys only the adapter against real Genesis, the ERC-8004 registry and Tokenbound", () => {
  const env = new Proxy({}, { get(_target, key) {
    assert.ok(!String(key).includes("PRIVATE_KEY"), "planning must not read a signing key");
    return undefined;
  } });
  const config = mainnetConfig(env);
  assert.equal(config.rpcUrl, "https://rpc.monad.xyz");
  assert.throws(() => mainnetConfig({ MONAD_MAINNET_RPC_URL: "http://rpc.monad.xyz" }), /HTTPS/);
  const plan = mainnetPlan(config);
  assert.equal(plan.chainId, 143);
  assert.equal(plan.broadcast, false);
  assert.deepEqual(plan.actions.map((action) => action.contract), ["ChogAdapter"]);
  assert.deepEqual(Object.values(plan.actions[0].constructor), [
    "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763", "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    "0x000000006551c19487814612e58FE06813775758", "0x55266d75D1a14E4572138116aF39863Ed6596E7F", ZeroHash,
  ]);
  assert.match(plan.adapterInitCodeHash, /^0x[0-9a-f]{64}$/);
});

test("the confirmation code changes with the deployer, nonce, chain or init code", () => {
  const base = { chainId: 143, deployer: new Wallet(KEY_A).address, nonce: 0, initCodeHash: keccak256("0x01") };
  const code = confirmationCode(base);
  assert.match(code, /^CHOG-[0-9A-F]{8}$/);
  assert.equal(confirmationCode({ ...base }), code);
  for (const change of [{ chainId: 10143 }, { deployer: new Wallet(KEY_B).address }, { nonce: 1 }, { initCodeHash: keccak256("0x02") }]) {
    assert.notEqual(confirmationCode({ ...base, ...change }), code);
  }
});

function fakeMainnet({ chainId = 143n, version = "2.0.0", implementation = MAINNET.registryImplementation, missing = [] } = {}) {
  const abi = new Interface([
    "function supportsInterface(bytes4) view returns (bool)", "function name() view returns (string)",
    "function getVersion() view returns (string)", "function account(address,bytes32,uint256,address,uint256) view returns (address)",
  ]);
  return {
    getNetwork: async () => ({ chainId }),
    getCode: async (address) => missing.includes(address) ? "0x" : "0x6001",
    getStorage: async () => `0x${implementation.slice(2).toLowerCase().padStart(64, "0")}`,
    call: async ({ data, gasLimit }) => {
      assert.ok(gasLimit !== undefined && gasLimit <= 100_000n, "mainnet reads must bound eth_call gas");
      const fragment = abi.getFunction(data.slice(0, 10));
      const values = { supportsInterface: [true], name: ["Chog Genesis"], getVersion: [version], account: ["0x488954ba227839a0EAc101Ef06CcC61527e084aC"] };
      return abi.encodeFunctionResult(fragment, values[fragment.name]);
    },
  };
}

test("mainnet preflight stops on a wrong chain, an upgraded or different registry, or missing Tokenbound code", async () => {
  const result = await checkMainnetDependencies(fakeMainnet());
  assert.equal(result.registryImplementation, MAINNET.registryImplementation);
  assert.equal(result.genesis.collectionName, "Chog Genesis");
  await assert.rejects(checkMainnetDependencies(fakeMainnet({ chainId: 10143n })), /requires chain 143/);
  await assert.rejects(checkMainnetDependencies(fakeMainnet({ implementation: "0x1111111111111111111111111111111111111111" })), /was upgraded/);
  await assert.rejects(checkMainnetDependencies(fakeMainnet({ version: "2.1.0" })), /reviewed against 2.0.0/);
  await assert.rejects(checkMainnetDependencies(fakeMainnet({ missing: [MAINNET.genesis] })), /no deployed code/);
  await assert.rejects(checkMainnetDependencies(fakeMainnet({ missing: [MAINNET.identityRegistry] })), /identity registry has no code/);
  for (const address of [MAINNET.tokenbound.registry, MAINNET.tokenbound.implementation]) {
    await assert.rejects(checkMainnetDependencies(fakeMainnet({ missing: [address] })), /Tokenbound/);
  }
});

test("the published source is only the adapter's own files and recompiles to the deployed creation code", { timeout: 300_000 }, () => {
  const standardJson = adapterStandardJson();
  const files = Object.keys(standardJson.input.sources);
  assert.ok(files.includes("contracts/ChogAdapter.sol"));
  assert.ok(files.every((file) => !file.startsWith("contracts/test/") && !file.startsWith("contracts/vendor/")), "test fixtures and vendored registries are not published");
  assert.equal(standardJson.input.settings.compilationTarget, undefined);
  const output = JSON.parse(solc.compile(JSON.stringify(standardJson.input)));
  assert.deepEqual((output.errors ?? []).filter((entry) => entry.severity === "error"), []);
  const recompiled = output.contracts["contracts/ChogAdapter.sol"].ChogAdapter.evm.bytecode.object;
  assert.equal(`0x${recompiled}`, artifact("ChogAdapter").bytecode, "the verifier must reproduce byte-identical code");
  const args = adapterConstructorArgs();
  assert.equal(constructorArgumentsHex(args), new Interface(artifact("ChogAdapter").abi).encodeDeploy(args).slice(2));
});

test("source publishing only accepts a confirmed, runtime-verified mainnet record", () => {
  fs.mkdirSync(".cache", { recursive: true });
  const directory = fs.mkdtempSync(path.resolve(".cache/verify-record-"));
  const write = (record) => { const file = path.join(directory, `${Math.random()}.json`); fs.writeFileSync(file, JSON.stringify(record)); return file; };
  const deployment = { address: MAINNET.genesis, transactionHash: ZeroHash, status: "confirmed", constructorArgs: adapterConstructorArgs() };
  const good = { chainId: 143, deployments: { ChogAdapter: deployment }, verification: { runtimeMatches: true } };
  assert.equal(readRecord(write(good)).address, MAINNET.genesis);
  assert.throws(() => readRecord(write({ ...good, chainId: 10143 })), /not a Monad mainnet/);
  assert.throws(() => readRecord(write({ ...good, deployments: { ChogAdapter: { ...deployment, status: "prepared" } } })), /confirmed deployment/);
  assert.throws(() => readRecord(write({ ...good, verification: undefined })), /confirmed deployment/);
});
