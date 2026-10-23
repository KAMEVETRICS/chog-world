import type pg from "pg";
import type { SoulAction } from "./config.js";

type Queryable = pg.Pool | pg.PoolClient;

export interface Account { readonly balance: bigint; readonly held: bigint }

export interface UsageReport {
  readonly model?: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly costUsd?: number | null;
}

export type HoldResult = { readonly ok: true } | { readonly ok: false; readonly code: "INSUFFICIENT_CREDITS" | "DUPLICATE" };

const lower = (address: string) => address.toLowerCase();

/**
 * $CHOG credits per holder wallet. Balances live in one row per address with check constraints, and every
 * movement is a ledger row unique by (kind, ref), so a deposit, hold, capture or refund applies at most once.
 */
export class PgCredits {
  readonly #pool: pg.Pool;
  readonly #now: () => number;

  constructor(pool: pg.Pool, now: () => number = Date.now) {
    this.#pool = pool;
    this.#now = now;
  }

  async #inTransaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
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

  /** Adds credits once per (kind, ref): a $CHOG deposit, or a grant in fixture mode. Returns false if already applied. */
  async credit(db: Queryable, address: string, amount: bigint, kind: "deposit" | "grant", ref: string): Promise<boolean> {
    if (amount <= 0n) throw new Error("Credit amounts must be positive.");
    await db.query("INSERT INTO credit_accounts (address) VALUES ($1) ON CONFLICT (address) DO NOTHING", [lower(address)]);
    const inserted = await db.query("INSERT INTO credit_ledger (address, kind, amount, ref, created_at) VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0)) ON CONFLICT (kind, ref) DO NOTHING",
      [lower(address), kind, amount.toString(), ref, this.#now()]);
    if (!inserted.rowCount) return false;
    await db.query("UPDATE credit_accounts SET balance = balance + $2 WHERE address = $1", [lower(address), amount.toString()]);
    return true;
  }

  async grant(address: string, amount: bigint, ref: string): Promise<boolean> {
    return this.#inTransaction((db) => this.credit(db, address, amount, "grant", ref));
  }

  /** Reserves `price` from the address's balance for one action, recorded as usage `id`. */
  async hold(id: string, address: string, agentKey: string, action: SoulAction, price: bigint): Promise<HoldResult> {
    return this.#inTransaction(async (db) => {
      const existing = await db.query("SELECT 1 FROM soul_usage WHERE id = $1", [id]);
      if (existing.rowCount) return { ok: false, code: "DUPLICATE" } as const;
      const moved = await db.query("UPDATE credit_accounts SET balance = balance - $2, held = held + $2 WHERE address = $1 AND balance >= $2", [lower(address), price.toString()]);
      if (!moved.rowCount) return { ok: false, code: "INSUFFICIENT_CREDITS" } as const;
      const now = this.#now();
      await db.query("INSERT INTO soul_usage (id, address, agent_key, action, price, status, created_at) VALUES ($1, $2, $3, $4, $5, 'held', to_timestamp($6 / 1000.0))",
        [id, lower(address), agentKey, action, price.toString(), now]);
      await db.query("INSERT INTO credit_ledger (address, kind, amount, ref, created_at) VALUES ($1, 'hold', $2, $3, to_timestamp($4 / 1000.0))", [lower(address), price.toString(), id, now]);
      return { ok: true } as const;
    });
  }

  /** Turns a hold into a charge. Uses the caller's transaction so the charge commits with what it paid for. */
  async capture(db: Queryable, id: string, report: UsageReport = {}): Promise<boolean> {
    const now = this.#now();
    const { rows } = await db.query<{ address: string; price: string }>(
      `UPDATE soul_usage SET status = 'charged', settled_at = to_timestamp($2 / 1000.0), model = $3, prompt_tokens = $4, completion_tokens = $5, provider_cost_usd = $6
       WHERE id = $1 AND status = 'held' RETURNING address, price`,
      [id, now, report.model ?? null, report.promptTokens ?? null, report.completionTokens ?? null, report.costUsd ?? null]);
    const row = rows[0];
    if (!row) return false;
    await db.query("UPDATE credit_accounts SET held = held - $2 WHERE address = $1", [row.address, row.price]);
    await db.query("INSERT INTO credit_ledger (address, kind, amount, ref, created_at) VALUES ($1, 'capture', $2, $3, to_timestamp($4 / 1000.0))", [row.address, row.price, id, now]);
    return true;
  }

  /** Returns a hold to the balance: the action failed or was not used. */
  async refund(db: Queryable, id: string, failure: string, report: UsageReport = {}): Promise<boolean> {
    const now = this.#now();
    const { rows } = await db.query<{ address: string; price: string }>(
      `UPDATE soul_usage SET status = 'refunded', settled_at = to_timestamp($2 / 1000.0), failure = $3, model = $4, prompt_tokens = $5, completion_tokens = $6, provider_cost_usd = $7
       WHERE id = $1 AND status = 'held' RETURNING address, price`,
      [id, now, failure.slice(0, 300), report.model ?? null, report.promptTokens ?? null, report.completionTokens ?? null, report.costUsd ?? null]);
    const row = rows[0];
    if (!row) return false;
    await db.query("UPDATE credit_accounts SET balance = balance + $2, held = held - $2 WHERE address = $1", [row.address, row.price]);
    await db.query("INSERT INTO credit_ledger (address, kind, amount, ref, created_at) VALUES ($1, 'refund', $2, $3, to_timestamp($4 / 1000.0))", [row.address, row.price, id, now]);
    return true;
  }

  async refundOutside(id: string, failure: string, report: UsageReport = {}): Promise<boolean> {
    return this.#inTransaction((db) => this.refund(db, id, failure, report));
  }

  /**
   * Refunds holds still open after `olderThanMs`: a process that crashed between hold and settle must not
   * keep a holder's credits. Returns how many were refunded.
   */
  async refundStale(olderThanMs: number): Promise<number> {
    const { rows } = await this.#pool.query<{ id: string }>("SELECT id FROM soul_usage WHERE status = 'held' AND created_at < to_timestamp($1 / 1000.0)", [this.#now() - olderThanMs]);
    let refunded = 0;
    for (const row of rows) if (await this.refundOutside(row.id, "Expired: the action never completed.")) refunded += 1;
    return refunded;
  }

  async recentUsage(address: string, limit = 20): Promise<{ id: string; action: string; agentKey: string; price: bigint; status: string; createdAt: string; failure: string | null }[]> {
    const { rows } = await this.#pool.query<{ id: string; action: string; agent_key: string; price: string; status: string; created_at: Date; failure: string | null }>(
      "SELECT id, action, agent_key, price, status, created_at, failure FROM soul_usage WHERE address = $1 ORDER BY created_at DESC LIMIT $2", [lower(address), limit]);
    return rows.map((row) => ({ id: row.id, action: row.action, agentKey: row.agent_key, price: BigInt(row.price), status: row.status, createdAt: row.created_at.toISOString(), failure: row.failure }));
  }

  async recentDeposits(address: string, limit = 10): Promise<{ txHash: string; amount: bigint; blockNumber: string; creditedAt: string }[]> {
    const { rows } = await this.#pool.query<{ tx_hash: string; amount: string; block_number: string; credited_at: Date }>(
      "SELECT tx_hash, amount, block_number, credited_at FROM credit_deposits WHERE payer = $1 ORDER BY block_number DESC, log_index DESC LIMIT $2", [lower(address), limit]);
    return rows.map((row) => ({ txHash: row.tx_hash, amount: BigInt(row.amount), blockNumber: String(row.block_number), creditedAt: row.credited_at.toISOString() }));
  }

  async account(address: string): Promise<Account> {
    const { rows } = await this.#pool.query<{ balance: string; held: string }>("SELECT balance, held FROM credit_accounts WHERE address = $1", [lower(address)]);
    return { balance: BigInt(rows[0]?.balance ?? 0), held: BigInt(rows[0]?.held ?? 0) };
  }

  /** Automatic spending by one Chog since the start of the current UTC day, held or charged. */
  async spentToday(agentKey: string): Promise<bigint> {
    const dayStart = new Date(this.#now());
    dayStart.setUTCHours(0, 0, 0, 0);
    const { rows } = await this.#pool.query<{ total: string | null }>(
      "SELECT sum(price) AS total FROM soul_usage WHERE agent_key = $1 AND action IN ('debate', 'vote') AND status IN ('held', 'charged') AND created_at >= to_timestamp($2 / 1000.0)",
      [agentKey, dayStart.getTime()]);
    return BigInt(rows[0]?.total ?? 0);
  }

  /** Ledger sums must equal balance + held + charged for every account. Returns mismatches (empty when consistent). */
  async reconcile(): Promise<string[]> {
    const { rows } = await this.#pool.query<{ address: string; balance: string; held: string; credited: string | null; held_total: string | null; captured: string | null; refunded: string | null }>(
      `SELECT a.address, a.balance, a.held,
        (SELECT sum(amount) FROM credit_ledger l WHERE l.address = a.address AND kind IN ('deposit', 'grant')) AS credited,
        (SELECT sum(amount) FROM credit_ledger l WHERE l.address = a.address AND kind = 'hold') AS held_total,
        (SELECT sum(amount) FROM credit_ledger l WHERE l.address = a.address AND kind = 'capture') AS captured,
        (SELECT sum(amount) FROM credit_ledger l WHERE l.address = a.address AND kind = 'refund') AS refunded
       FROM credit_accounts a`);
    const problems: string[] = [];
    for (const row of rows) {
      const credited = BigInt(row.credited ?? 0), holds = BigInt(row.held_total ?? 0), captured = BigInt(row.captured ?? 0), refunded = BigInt(row.refunded ?? 0);
      if (BigInt(row.balance) !== credited - holds + refunded) problems.push(`${row.address}: balance ${row.balance}, ledger says ${credited - holds + refunded}`);
      if (BigInt(row.held) !== holds - captured - refunded) problems.push(`${row.address}: held ${row.held}, ledger says ${holds - captured - refunded}`);
    }
    return problems;
  }
}
