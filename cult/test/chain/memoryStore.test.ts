import { describe } from "vitest";
import { MemoryProjectionStore } from "../../src/chain/projection.js";
import { projectionStoreContract } from "./storeContract.js";

describe("memory projection store", () => {
  projectionStoreContract(async () => new MemoryProjectionStore());
});
