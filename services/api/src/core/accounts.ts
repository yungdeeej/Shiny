/** System account map + per-user game balance helpers (all ledger-backed). */
import type { LedgerService, SystemAccountKind, Db } from "@trash-wars/db";
import { accounts, ledgerEntries, missions } from "@trash-wars/db";
import { and, eq, inArray, sql } from "./orm.js";

export type SystemAccounts = Record<SystemAccountKind, string>;

export async function getUserAccount(ledger: LedgerService, userId: string): Promise<string> {
  return ledger.ensureAccount("user", userId, "game_balance");
}

/** Sum of stakes locked in this user's active missions. */
export async function lockedBalance(db: Db, userId: string): Promise<bigint> {
  const rows = await db
    .select({ v: sql<string>`coalesce(sum(${missions.stake}), 0)::text` })
    .from(missions)
    .where(and(eq(missions.userId, userId), eq(missions.state, "active")));
  return BigInt(rows[0]?.v ?? "0");
}

export async function unlockedBalance(
  db: Db,
  ledger: LedgerService,
  userId: string,
): Promise<{ balance: bigint; locked: bigint; unlocked: bigint }> {
  const account = await getUserAccount(ledger, userId);
  const [balance, locked] = await Promise.all([
    ledger.getBalance(account),
    lockedBalance(db, userId),
  ]);
  return { balance, locked, unlocked: balance - locked };
}

/** Sum of balances over account kinds (proof-of-reserves liabilities, public stats). */
export async function sumBalanceByKinds(
  db: Db,
  kinds: ("game_balance" | "withdrawals_payable" | "burn_pool" | "burned")[],
): Promise<bigint> {
  const rows = await db
    .select({ v: sql<string>`coalesce(sum(${ledgerEntries.delta}), 0)::text` })
    .from(ledgerEntries)
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(inArray(accounts.kind, kinds));
  return BigInt(rows[0]?.v ?? "0");
}
