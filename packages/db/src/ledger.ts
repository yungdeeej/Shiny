/**
 * Double-entry ledger. The single source of truth for all $SHINY balances:
 * no column anywhere stores a mutable "balance" — balances are SUM(delta) per account.
 *
 * A logical transaction = one ledger_txns row (idempotency_key UNIQUE) + 2..n ledger_entries
 * legs that sum to zero per currency. Idempotent replays are detected via the parent row's
 * unique key and reported as { applied: false } without throwing.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  ACCOUNT_KINDS,
  accounts,
  ledgerEntries,
  ledgerTxns,
  type AccountKind,
} from "./schema.js";

export const DEFAULT_CURRENCY = "SHINY";

export type AccountOwnerType = "user" | "system";

/** Every account kind except the per-user game_balance is a system singleton. */
export const SYSTEM_ACCOUNT_KINDS = ACCOUNT_KINDS.filter(
  (k): k is Exclude<AccountKind, "game_balance"> => k !== "game_balance",
);
export type SystemAccountKind = (typeof SYSTEM_ACCOUNT_KINDS)[number];

export interface LedgerEntryInput {
  accountId: string;
  delta: bigint;
  currency?: string;
}

export interface PostTransactionOptions {
  idempotencyKey: string;
  refType?: string;
  refId?: string;
}

export interface PostTransactionResult {
  /** false when the idempotency key was already used (replay) — nothing was written. */
  applied: boolean;
  /** id of the ledger_txns row (the existing one on replay). */
  txnId: string;
}

export class LedgerService {
  constructor(private readonly db: Db) {}

  /**
   * Atomically posts a balanced multi-leg transaction.
   * Validates: >= 2 legs, every delta != 0, legs sum to 0 per currency.
   * Concurrency-safe: the UNIQUE(idempotency_key) on ledger_txns is the arbiter — under
   * races exactly one caller applies; the rest get { applied: false }.
   */
  async postTransaction(
    entries: LedgerEntryInput[],
    opts: PostTransactionOptions,
  ): Promise<PostTransactionResult> {
    if (entries.length < 2) {
      throw new Error("ledger: a transaction requires at least 2 entries (double-entry)");
    }
    const sums = new Map<string, bigint>();
    for (const entry of entries) {
      if (entry.delta === 0n) {
        throw new Error("ledger: entry delta must be non-zero");
      }
      const currency = entry.currency ?? DEFAULT_CURRENCY;
      sums.set(currency, (sums.get(currency) ?? 0n) + entry.delta);
    }
    for (const [currency, sum] of sums) {
      if (sum !== 0n) {
        throw new Error(`ledger: unbalanced transaction for ${currency} (sum=${sum})`);
      }
    }

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(ledgerTxns)
        .values({
          idempotencyKey: opts.idempotencyKey,
          refType: opts.refType ?? null,
          refId: opts.refId ?? null,
        })
        .onConflictDoNothing({ target: ledgerTxns.idempotencyKey })
        .returning({ id: ledgerTxns.id });

      const txn = inserted[0];
      if (!txn) {
        // Idempotent replay — surface the existing txn id, write nothing.
        const existing = await tx
          .select({ id: ledgerTxns.id })
          .from(ledgerTxns)
          .where(eq(ledgerTxns.idempotencyKey, opts.idempotencyKey))
          .limit(1);
        return { applied: false, txnId: existing[0]?.id ?? "" };
      }

      await tx.insert(ledgerEntries).values(
        entries.map((entry) => ({
          txnId: txn.id,
          accountId: entry.accountId,
          delta: entry.delta,
          currency: entry.currency ?? DEFAULT_CURRENCY,
        })),
      );

      return { applied: true, txnId: txn.id };
    });
  }

  /**
   * Balance = COALESCE(SUM(delta), 0). Summed and cast to text in SQL, converted with
   * BigInt() — pg returns int8 as string, and Number would lose precision past 2^53.
   */
  async getBalance(accountId: string): Promise<bigint> {
    const rows = await this.db
      .select({ balance: sql<string>`coalesce(sum(${ledgerEntries.delta}), 0)::text` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, accountId));
    return BigInt(rows[0]?.balance ?? "0");
  }

  /** Batched balances; accounts with no entries map to 0n. */
  async getBalances(accountIds: string[]): Promise<Map<string, bigint>> {
    const balances = new Map<string, bigint>(accountIds.map((id) => [id, 0n]));
    if (accountIds.length === 0) return balances;
    const rows = await this.db
      .select({
        accountId: ledgerEntries.accountId,
        balance: sql<string>`coalesce(sum(${ledgerEntries.delta}), 0)::text`,
      })
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.accountId, accountIds))
      .groupBy(ledgerEntries.accountId);
    for (const row of rows) {
      balances.set(row.accountId, BigInt(row.balance));
    }
    return balances;
  }

  /** Get-or-create an account, race-safe via the partial unique indexes on accounts. */
  async ensureAccount(
    ownerType: AccountOwnerType,
    ownerId: string | null,
    kind: AccountKind,
  ): Promise<string> {
    const where = and(
      eq(accounts.ownerType, ownerType),
      eq(accounts.kind, kind),
      ownerId === null ? isNull(accounts.ownerId) : eq(accounts.ownerId, ownerId),
    );

    const existing = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(where)
      .limit(1);
    if (existing[0]) return existing[0].id;

    const inserted = await this.db
      .insert(accounts)
      .values({ ownerType, ownerId, kind })
      .onConflictDoNothing()
      .returning({ id: accounts.id });
    if (inserted[0]) return inserted[0].id;

    // Lost a race — the conflicting row must exist now.
    const raced = await this.db.select({ id: accounts.id }).from(accounts).where(where).limit(1);
    if (!raced[0]) {
      throw new Error(`ledger: failed to ensure account ${ownerType}/${ownerId}/${kind}`);
    }
    return raced[0].id;
  }

  /** Creates all system singleton accounts (idempotent) and returns kind → account id. */
  async ensureSystemAccounts(): Promise<Record<SystemAccountKind, string>> {
    const result = {} as Record<SystemAccountKind, string>;
    for (const kind of SYSTEM_ACCOUNT_KINDS) {
      result[kind] = await this.ensureAccount("system", null, kind);
    }
    return result;
  }
}
