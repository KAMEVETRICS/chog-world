import { describe, expect, it } from "vitest";
import { runAcceptance } from "../../src/demo/acceptance.js";
import { DATABASE_URL } from "./helpers.js";

const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("acceptance demo", () => {
  it("passes every design acceptance check with two viewers", { timeout: 120_000 }, async () => {
    const checks = await runAcceptance(DATABASE_URL!);
    expect(checks.map((entry) => entry.name)).toHaveLength(7);
    expect(checks.filter((entry) => !entry.ok)).toEqual([]);
  });
});
