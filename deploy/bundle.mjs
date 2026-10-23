// Packs what the server needs into chog-world.tar.gz, for upload to the VPS: cult/, city/, the mainnet
// manifest and deploy/. Leaves out dependencies, build output and every .env file (secrets stay on your machines).
//   node deploy/bundle.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// A relative name: GNU tar (Git Bash) would read "C:" in an absolute Windows path as a remote host.
const name = "chog-world.tar.gz";
const out = path.join(root, name);
const include = ["cult", "city", "deploy", "deployments/manifests/monad-mainnet.json", ".dockerignore"];
for (const entry of include) {
  if (!fs.existsSync(path.join(root, entry))) throw new Error(`Missing ${entry}; run this from the repository.`);
}
const exclude = ["node_modules", "dist", ".cache", "coverage", ".env", ".env.*", "*.tar.gz"];
execFileSync("tar", ["-czf", name, ...exclude.flatMap((pattern) => ["--exclude", pattern]), ...include], { cwd: root, stdio: "inherit" });

// Check the archive, not just the intent: no secrets, no dependencies.
const listed = execFileSync("tar", ["-tzf", name], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
const leaked = listed.filter((name) => /(^|\/)(\.env(\..*)?|node_modules)(\/|$)/.test(name) && !name.endsWith(".env.example"));
if (leaked.length) {
  fs.rmSync(out);
  throw new Error(`Refusing to keep the bundle: it contained ${leaked.slice(0, 3).join(", ")}.`);
}
console.log(`Wrote ${path.relative(process.cwd(), out) || out}: ${listed.length} entries, ${(fs.statSync(out).size / 1024).toFixed(0)} KB, no .env files or dependencies.`);
