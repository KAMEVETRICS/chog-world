import type pg from "pg";
import { MalformedRpcResult, TRANSFER_TOPIC, parseAddress, parseHash, parseHex, parseQuantity, quantity, requireBlock } from "../chain/evm.js";
import type { JsonRpc } from "../chain/rpc.js";
import type { PgCredits } from "./credits.js";

export interface DepositIndexerOptions {
  readonly pool: pg.Pool;
  readonly rpc: JsonRpc;
  readonly credits: PgCredits;
  readonly chainId: number;
  readonly token: string;
  readonly treasury: string;
  /** First block to read on a new database (for example the block the treasury was set up). */
  readonly startBlock: bigint;
  /** Monad's public RPC answers eth_getLogs for at most 100 blocks. */
  readonly chunkBlocks?: number;
  readonly now?: () => number;
}

export interface IndexerStep { readonly fromBlock: bigint; readonly toBlock: bigint; readonly credited: number; readonly caughtUp: boolean }

const topicAddress = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

/**
 * Credits $CHOG sent to the treasury. Reads `Transfer(from, treasury, value)` logs up to the finalized
 * block only, so nothing credited can be reorged away; each log credits its sender once.
 */
export class DepositIndexer {
  readonly #options: Required<Omit<DepositIndexerOptions, "now">> & { now: () => number };

  constructor(options: DepositIndexerOptions) {
    this.#options = { chunkBlocks: 100, now: Date.now, ...options, token: options.token.toLowerCase(), treasury: options.treasury.toLowerCase() };
  }

  /** Creates the cursor once; refuses a database that was indexing another token, treasury or chain. */
  async initialize(): Promise<void> {
    const { pool, chainId, token, treasury, startBlock } = this.#options;
    await pool.query("INSERT INTO credit_indexer (id, chain_id, token, treasury, cursor_block) VALUES (1, $1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
      [chainId, token, treasury, (startBlock > 0n ? startBlock - 1n : 0n).toString()]);
    const { rows } = await pool.query<{ chain_id: number; token: string; treasury: string }>("SELECT chain_id, token, treasury FROM credit_indexer WHERE id = 1");
    const row = rows[0]!;
    if (row.chain_id !== chainId || row.token !== token || row.treasury !== treasury) {
      throw new Error(`This database indexes deposits for ${row.token} to ${row.treasury} on chain ${row.chain_id}; refusing to mix in another token, treasury or chain.`);
    }
  }

  /** Reads one chunk of finalized blocks. Call repeatedly; `caughtUp` says when it reached the finalized head. */
  async step(): Promise<IndexerStep> {
    const { pool, rpc, credits, token, treasury, chunkBlocks } = this.#options;
    const cursor = BigInt((await pool.query<{ cursor_block: string }>("SELECT cursor_block FROM credit_indexer WHERE id = 1")).rows[0]!.cursor_block);
    const finalized = (await requireBlock(rpc, "finalized")).number;
    const fromBlock = cursor + 1n;
    if (fromBlock > finalized) return { fromBlock, toBlock: cursor, credited: 0, caughtUp: true };
    const toBlock = fromBlock + BigInt(chunkBlocks) - 1n < finalized ? fromBlock + BigInt(chunkBlocks) - 1n : finalized;
    const raw = await rpc.request("eth_getLogs", [{ address: token, topics: [TRANSFER_TOPIC, null, topicAddress(treasury)], fromBlock: quantity(fromBlock), toBlock: quantity(toBlock) }]);
    if (!Array.isArray(raw)) throw new MalformedRpcResult("eth_getLogs returned something other than a list.");
    const deposits = raw.map((log: Record<string, unknown>, index) => {
      const label = `Deposit log ${index}`;
      const topics = log.topics as unknown[];
      if (log.removed === true) throw new MalformedRpcResult(`${label} is marked removed in a finalized range.`);
      if (parseAddress(log.address, `${label} address`) !== token || !Array.isArray(topics) || topics.length !== 3
        || String(topics[0]).toLowerCase() !== TRANSFER_TOPIC || String(topics[2]).toLowerCase() !== topicAddress(treasury)) {
        throw new MalformedRpcResult(`${label} is not a $CHOG transfer to the treasury.`);
      }
      const block = parseQuantity(log.blockNumber, `${label} block`);
      if (block < fromBlock || block > toBlock) throw new MalformedRpcResult(`${label} is outside the requested blocks.`);
      const data = parseHex(log.data, `${label} data`);
      if (data.length !== 66) throw new MalformedRpcResult(`${label} has no 32-byte amount.`);
      return {
        txHash: parseHash(log.transactionHash, `${label} transaction`), logIndex: Number(parseQuantity(log.logIndex, `${label} index`)), block,
        payer: `0x${parseHash(topics[1], `${label} sender`).slice(26)}`, amount: BigInt(data),
      };
    });
    const db = await pool.connect();
    let credited = 0;
    try {
      await db.query("BEGIN");
      // Re-check the cursor under a row lock, so two indexers never apply the same chunk twice.
      const locked = BigInt((await db.query<{ cursor_block: string }>("SELECT cursor_block FROM credit_indexer WHERE id = 1 FOR UPDATE")).rows[0]!.cursor_block);
      if (locked !== cursor) { await db.query("ROLLBACK"); return { fromBlock, toBlock, credited: 0, caughtUp: false }; }
      for (const deposit of deposits) {
        if (deposit.amount === 0n) continue;
        const inserted = await db.query(
          "INSERT INTO credit_deposits (tx_hash, log_index, block_number, payer, amount, credited_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0)) ON CONFLICT DO NOTHING",
          [deposit.txHash, deposit.logIndex, deposit.block.toString(), deposit.payer, deposit.amount.toString(), this.#options.now()]);
        if (inserted.rowCount && await credits.credit(db, deposit.payer, deposit.amount, "deposit", `${deposit.txHash}:${deposit.logIndex}`)) credited += 1;
      }
      await db.query("UPDATE credit_indexer SET cursor_block = $1 WHERE id = 1", [toBlock.toString()]);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
    return { fromBlock, toBlock, credited, caughtUp: toBlock === finalized };
  }

  /** Steps until caught up or `maxSteps` chunks were read. */
  async catchUp(maxSteps = 20): Promise<IndexerStep[]> {
    const steps: IndexerStep[] = [];
    for (let index = 0; index < maxSteps; index++) {
      const step = await this.step();
      steps.push(step);
      if (step.caughtUp) break;
    }
    return steps;
  }
}
