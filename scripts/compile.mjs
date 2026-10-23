import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const root = process.cwd();
function sourcesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourcesIn(filename) : filename.endsWith(".sol") ? [filename] : [];
  });
}
const sources = Object.fromEntries(sourcesIn(path.join(root, "contracts")).map((filename) => [
  path.relative(root, filename).replaceAll("\\", "/"), { content: fs.readFileSync(filename, "utf8") },
]));
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), {
  import(filename) {
    try { return { contents: fs.readFileSync(path.join(root, "node_modules", filename), "utf8") }; }
    catch { return { error: `Import not found: ${filename}` }; }
  },
}));
for (const diagnostic of output.errors ?? []) console.error(diagnostic.formattedMessage);
if (output.errors?.some((entry) => entry.severity === "error")) process.exit(1);
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync("artifacts/compiled.json", JSON.stringify({ compiler: solc.version(), input, contracts: output.contracts }, null, 2));
console.log(`Compiled ${Object.keys(sources).length} source files with solc ${solc.version()} (Shanghai).`);
