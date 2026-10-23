import { DEMO_CYCLES, runDemo } from "../demo/runDemo.js";

const requested = Number(process.argv[2] ?? DEMO_CYCLES);
if (!Number.isInteger(requested) || requested < 1 || requested > 50) {
  console.error("Usage: npm.cmd run demo -- [cycles 1-50]");
  process.exitCode = 1;
} else {
  const { lines } = await runDemo(requested);
  console.log(lines.join("\n"));
}
