import type pg from "pg";
import { projectionScope, type BlockRef, type ProjectionConfig, type ProjectionHead, type ProjectionStore, type ProjectionUpdate, type TokenProjection } from "./projection.js";

interface HeadRow { cursor_block: string; cursor_hash: string; generation: string; activation_hash: string }

/** The ownership projection in PostgreSQL (migrations/003_ownership.sql). Each update is one transaction. */
export class PgProjectionStore implements ProjectionStore {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async #transaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
    const db = await this.#pool.connect();
    try {
      await db.query("BEGIN");
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async #head(db: pg.PoolClient | pg.Pool, scope: string, row: HeadRow): Promise<ProjectionHead> {
    const { rows } = await db.query<{ block_number: string; block_hash: string }>(
      "SELECT block_number, block_hash FROM ownership_checkpoints WHERE scope = $1 ORDER BY block_number", [scope]);
    return {
      cursor: { number: BigInt(row.cursor_block), hash: row.cursor_hash }, generation: BigInt(row.generation),
      checkpoints: rows.map((checkpoint) => ({ number: BigInt(checkpoint.block_number), hash: checkpoint.block_hash })),
    };
  }

  async open(config: ProjectionConfig): Promise<ProjectionHead> {
    const scope = projectionScope(config);
    return this.#transaction(async (db) => {
      await db.query(
        `INSERT INTO ownership_projection (scope, chain_id, collection, activation_block, activation_hash, cursor_block, cursor_hash, generation)
         VALUES ($1, $2, $3, $4, $5, $4, $5, 1) ON CONFLICT (scope) DO NOTHING`,
        [scope, config.chainId, config.collection, config.activation.number.toString(), config.activation.hash]);
      await db.query("INSERT INTO ownership_checkpoints (scope, block_number, block_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [scope, config.activation.number.toString(), config.activation.hash]);
      const { rows } = await db.query<HeadRow>("SELECT cursor_block, cursor_hash, generation, activation_hash FROM ownership_projection WHERE scope = $1", [scope]);
      if (rows[0]!.activation_hash !== config.activation.hash) throw new Error("The stored projection was built from a different activation block.");
      return this.#head(db, scope, rows[0]!);
    });
  }

  async apply(config: ProjectionConfig, expected: ProjectionHead, update: ProjectionUpdate, retain: number): Promise<ProjectionHead | null> {
    const scope = projectionScope(config);
    return this.#transaction(async (db) => {
      const { rows } = await db.query<HeadRow>("SELECT cursor_block, cursor_hash, generation, activation_hash FROM ownership_projection WHERE scope = $1 FOR UPDATE", [scope]);
      const row = rows[0];
      if (!row) throw new Error("Projection is not open.");
      if (BigInt(row.cursor_block) !== expected.cursor.number || row.cursor_hash !== expected.cursor.hash || BigInt(row.generation) !== expected.generation) return null;
      let cursor: BlockRef;
      let generation = expected.generation;
      if (update.kind === "advance") {
        if (update.to.number <= expected.cursor.number) throw new Error("An advance must move the cursor forward.");
        for (const transfer of update.transfers) {
          if (transfer.blockNumber <= expected.cursor.number || transfer.blockNumber > update.to.number) throw new Error("Transfer outside the advanced range.");
          await db.query(
            `INSERT INTO ownership_transfers (scope, block_number, block_hash, log_index, transaction_hash, token_id, from_address, to_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [scope, transfer.blockNumber.toString(), transfer.blockHash, transfer.logIndex, transfer.transactionHash, transfer.tokenId, transfer.from, transfer.to]);
        }
        await db.query("INSERT INTO ownership_checkpoints (scope, block_number, block_hash) VALUES ($1, $2, $3)", [scope, update.to.number.toString(), update.to.hash]);
        // Keep the activation block and the newest `retain` checkpoints.
        await db.query(
          `DELETE FROM ownership_checkpoints WHERE scope = $1 AND block_number <> $2 AND block_number NOT IN (
             SELECT block_number FROM ownership_checkpoints WHERE scope = $1 AND block_number <> $2 ORDER BY block_number DESC LIMIT $3)`,
          [scope, config.activation.number.toString(), retain]);
        cursor = update.to;
      } else {
        const target = await db.query("SELECT 1 FROM ownership_checkpoints WHERE scope = $1 AND block_number = $2 AND block_hash = $3",
          [scope, update.to.number.toString(), update.to.hash]);
        if (target.rowCount !== 1) throw new Error("A rewind must target a retained checkpoint.");
        generation += 1n;
        await db.query("UPDATE ownership_transfers SET orphaned_generation = $3 WHERE scope = $1 AND orphaned_generation IS NULL AND block_number > $2",
          [scope, update.to.number.toString(), generation.toString()]);
        await db.query("DELETE FROM ownership_checkpoints WHERE scope = $1 AND block_number > $2", [scope, update.to.number.toString()]);
        cursor = update.to;
      }
      await db.query("UPDATE ownership_projection SET cursor_block = $2, cursor_hash = $3, generation = $4, updated_at = now() WHERE scope = $1",
        [scope, cursor.number.toString(), cursor.hash, generation.toString()]);
      return this.#head(db, scope, { cursor_block: cursor.number.toString(), cursor_hash: cursor.hash, generation: generation.toString(), activation_hash: row.activation_hash });
    });
  }

  async token(config: ProjectionConfig, tokenId: string): Promise<TokenProjection> {
    // One statement, so the head and the token's history come from the same snapshot.
    const { rows } = await this.#pool.query<{
      cursor_block: string; cursor_hash: string; generation: string; canonical: string; orphaned: string;
      block_number: string | null; block_hash: string | null; log_index: number | null; transaction_hash: string | null; from_address: string | null; to_address: string | null;
    }>(
      `SELECT p.cursor_block, p.cursor_hash, p.generation,
         (SELECT count(*) FROM ownership_transfers t WHERE t.scope = p.scope AND t.token_id = $2 AND t.orphaned_generation IS NULL) AS canonical,
         (SELECT count(*) FROM ownership_transfers t WHERE t.scope = p.scope AND t.token_id = $2 AND t.orphaned_generation IS NOT NULL) AS orphaned,
         l.block_number, l.block_hash, l.log_index, l.transaction_hash, l.from_address, l.to_address
       FROM ownership_projection p
       LEFT JOIN LATERAL (
         SELECT block_number, block_hash, log_index, transaction_hash, from_address, to_address FROM ownership_transfers t
         WHERE t.scope = p.scope AND t.token_id = $2 AND t.orphaned_generation IS NULL
         ORDER BY block_number DESC, log_index DESC LIMIT 1) l ON true
       WHERE p.scope = $1`,
      [projectionScope(config), tokenId]);
    const row = rows[0];
    if (!row) throw new Error("Projection is not open.");
    return {
      cursor: { number: BigInt(row.cursor_block), hash: row.cursor_hash }, generation: BigInt(row.generation),
      canonicalTransfers: Number(row.canonical), orphanedTransfers: Number(row.orphaned),
      latest: row.block_number === null ? null : {
        blockNumber: BigInt(row.block_number), blockHash: row.block_hash!, logIndex: row.log_index!, transactionHash: row.transaction_hash!,
        tokenId, from: row.from_address!, to: row.to_address!,
      },
    };
  }
}
