// Publishes the ChogAdapter source for a deployed Monad mainnet adapter.
//   npm.cmd run verify:mainnet -- --record deployments/<file>-monad-mainnet.json [--dry-run]
// Sourcify needs no key. MonadScan (Etherscan v2 API) runs only when MONADSCAN_API_KEY is set.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ContractFactory, getAddress, keccak256, toUtf8Bytes } from "ethers";
import { MAINNET } from "./mainnet.mjs";

const CONTRACT = "contracts/ChogAdapter.sol:ChogAdapter";

function compiledAdapter() {
  const build = JSON.parse(fs.readFileSync(new URL("../artifacts/compiled.json", import.meta.url)));
  const [file, name] = CONTRACT.split(":");
  return { build, contract: build.contracts[file][name] };
}

/// Standard JSON input holding only the sources in the adapter's metadata, each checked against its metadata hash.
export function adapterStandardJson(root = process.cwd()) {
  const { build, contract } = compiledAdapter();
  const metadata = JSON.parse(contract.metadata);
  const sources = {};
  for (const [file, { keccak256: expected }] of Object.entries(metadata.sources)) {
    const content = build.input.sources[file]?.content ?? fs.readFileSync(path.join(root, "node_modules", file), "utf8");
    if (keccak256(toUtf8Bytes(content)) !== expected) throw new Error(`Source ${file} differs from the compiled metadata; recompile before verifying.`);
    sources[file] = { content };
  }
  const { compilationTarget: _target, ...settings } = metadata.settings;
  return {
    compilerVersion: metadata.compiler.version,
    input: { language: "Solidity", sources, settings: { ...settings, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } } } },
  };
}

export function constructorArgumentsHex(args) {
  const { contract } = compiledAdapter();
  return new ContractFactory(contract.abi, `0x${contract.evm.bytecode.object}`).interface.encodeDeploy(args).slice(2);
}

export function readRecord(file) {
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const deployment = record.deployments?.ChogAdapter;
  if (record.chainId !== MAINNET.chainId || !deployment) throw new Error("The record is not a Monad mainnet ChogAdapter deployment.");
  if (deployment.status !== "confirmed" || !record.verification?.runtimeMatches) {
    throw new Error("Only a confirmed deployment whose runtime code was verified can be published. Run deploy:mainnet -- --check <address> first.");
  }
  return { address: getAddress(deployment.address), transactionHash: deployment.transactionHash, constructorArgs: deployment.constructorArgs };
}

async function request(url, options, label) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sourcify({ address, transactionHash }, standardJson) {
  const base = "https://sourcify.dev/server";
  const existing = await fetch(`${base}/v2/contract/${MAINNET.chainId}/${address}`, { signal: AbortSignal.timeout(60_000) });
  // HTTP 200 means Sourcify already holds a verified match; 404 means it still needs submitting.
  if (existing.ok) return { verifier: "Sourcify", match: (await existing.json()).match, url: `https://repo.sourcify.dev/${MAINNET.chainId}/${address}`, alreadyVerified: true };
  if (existing.status !== 404) throw new Error(`Sourcify lookup returned HTTP ${existing.status}.`);
  const submitted = await request(`${base}/v2/verify/${MAINNET.chainId}/${address}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stdJsonInput: standardJson.input, compilerVersion: standardJson.compilerVersion, contractIdentifier: CONTRACT, creationTransactionHash: transactionHash }),
  }, "Sourcify");
  for (let attempt = 0; attempt < 30; attempt++) {
    await pause(5000);
    const job = await request(`${base}/v2/verify/${submitted.verificationId}`, {}, "Sourcify status");
    if (job.isJobCompleted) {
      if (job.error) throw new Error(`Sourcify rejected the source: ${job.error.message ?? JSON.stringify(job.error).slice(0, 300)}`);
      return { verifier: "Sourcify", match: job.contract?.match ?? job.contract?.runtimeMatch, url: `https://repo.sourcify.dev/${MAINNET.chainId}/${address}` };
    }
  }
  throw new Error(`Sourcify job ${submitted.verificationId} did not finish in time; check it later.`);
}

async function monadscan({ address, constructorArgs }, standardJson, apiKey) {
  const endpoint = `https://api.etherscan.io/v2/api?chainid=${MAINNET.chainId}`;
  // The API key goes in the POST body, never in the URL.
  const form = new URLSearchParams({
    apikey: apiKey, module: "contract", action: "verifysourcecode", contractaddress: address,
    sourceCode: JSON.stringify(standardJson.input), codeformat: "solidity-standard-json-input",
    contractname: CONTRACT, compilerversion: `v${standardJson.compilerVersion}`, constructorArguements: constructorArgumentsHex(constructorArgs),
  });
  const submitted = await request(endpoint, { method: "POST", body: form }, "MonadScan");
  if (submitted.status !== "1") throw new Error(`MonadScan rejected the submission: ${submitted.result}`);
  for (let attempt = 0; attempt < 30; attempt++) {
    await pause(5000);
    const status = await request(endpoint, { method: "POST", body: new URLSearchParams({ apikey: apiKey, module: "contract", action: "checkverifystatus", guid: submitted.result }) }, "MonadScan status");
    if (/pending/i.test(status.result)) continue;
    if (status.status !== "1" && !/already verified/i.test(status.result)) throw new Error(`MonadScan verification failed: ${status.result}`);
    return { verifier: "MonadScan", result: status.result, url: `https://monadscan.com/address/${address}#code` };
  }
  throw new Error("MonadScan verification did not finish in time; check the explorer later.");
}

async function main() {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const argv = process.argv.slice(2);
  const recordFile = argv[argv.indexOf("--record") + 1];
  if (!argv.includes("--record") || !recordFile) throw new Error("Pass --record deployments/<file>-monad-mainnet.json.");
  const deployment = readRecord(recordFile);
  const standardJson = adapterStandardJson();
  console.log(`Prepared ${Object.keys(standardJson.input.sources).length} source files for ${deployment.address} (solc ${standardJson.compilerVersion}).`);
  if (argv.includes("--dry-run")) { console.log("Dry run: nothing was submitted."); return; }
  const results = [await sourcify(deployment, standardJson)];
  if (process.env.MONADSCAN_API_KEY) results.push(await monadscan(deployment, standardJson, process.env.MONADSCAN_API_KEY));
  else console.log("MONADSCAN_API_KEY is not set; skipped MonadScan.");
  console.log(JSON.stringify(results, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
