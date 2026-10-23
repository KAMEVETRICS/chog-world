import fs from "node:fs";

export function loadArtifact(name) {
  const build = JSON.parse(fs.readFileSync(new URL("../artifacts/compiled.json", import.meta.url)));
  const matches = Object.entries(build.contracts).flatMap(([filename, contracts]) =>
    Object.entries(contracts).filter(([contractName]) => name === contractName || name === `${filename}:${contractName}`)
      .map(([, result]) => result));
  if (matches.length !== 1) throw new Error(`Expected one compiled contract named ${name}; found ${matches.length}`);
  return { abi: matches[0].abi, bytecode: `0x${matches[0].evm.bytecode.object}`, compiler: build.compiler };
}
