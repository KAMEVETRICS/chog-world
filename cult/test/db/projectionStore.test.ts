import { describe } from "vitest";
import { PgProjectionStore } from "../../src/chain/pgProjectionStore.js";
import { projectionStoreContract } from "../chain/storeContract.js";
import { DATABASE_URL, freshSchema } from "./helpers.js";

const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("PostgreSQL projection store", () => {
  projectionStoreContract(async () => new PgProjectionStore((await freshSchema()).pool));
});
