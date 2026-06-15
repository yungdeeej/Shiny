/**
 * Weekly on-chain burn (doc 09 — BURN MACHINE).
 *
 * 1. Read the burn_pool ledger balance (the in-game accumulator that mirrors
 *    tokens physically sitting in custody — they entered via deposits).
 * 2. Execute the real SPL burnChecked from the custody ATA.
 * 3. Post burn_pool → terminal `burned` account with the tx sig, idempotent per
 *    ISO week (`weekly-burn:{ISO-week}`).
 * 4. Write a breakdown audit row (by ledger ref_type over the week) and draft a
 *    Discord announcement for human review.
 *
 * Idempotency: the ledger idempotency key is the arbiter. A second run in the
 * same week posts nothing and burns nothing on-chain.
 */
import { sql } from "../orm.js";
import { auditLog, ledgerEntries, ledgerTxns, accounts } from "@trash-wars/db";
import type { AppContext } from "@trash-wars/api/core";
import { postDiscord } from "../alerts.js";

/** ISO-8601 week key, e.g. 2026-W24 (UTC). Mirrors the API scheduler helper. */
export function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface WeeklyBurnResult {
  week: string;
  burned: bigint;
  txSig: string | null;
  applied: boolean;
}

/** Sum of burn_pool credits this week, grouped by ref_type, for the breakdown. */
async function burnBreakdown(
  ctx: AppContext,
  since: Date,
): Promise<Record<string, string>> {
  const rows = await ctx.db
    .select({
      refType: sql<string>`coalesce(${ledgerTxns.refType}, 'other')`,
      total: sql<string>`sum(${ledgerEntries.delta})::text`,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTxns, sql`${ledgerTxns.id} = ${ledgerEntries.txnId}`)
    .innerJoin(accounts, sql`${accounts.id} = ${ledgerEntries.accountId}`)
    .where(
      sql`${accounts.kind} = 'burn_pool' and ${ledgerEntries.delta} > 0 and ${ledgerEntries.createdAt} >= ${since.toISOString()}`,
    )
    .groupBy(sql`coalesce(${ledgerTxns.refType}, 'other')`);
  const out: Record<string, string> = {};
  for (const r of rows) out[r.refType] = r.total;
  return out;
}

export async function executeWeeklyBurn(
  ctx: AppContext,
  opts: { discordWebhookUrl?: string; now?: Date } = {},
): Promise<WeeklyBurnResult> {
  const now = opts.now ?? new Date();
  const week = isoWeekKey(now);

  const pool = await ctx.ledger.getBalance(ctx.accounts.burn_pool);
  if (pool <= 0n) {
    ctx.log.info({ week }, "weekly burn: empty burn_pool, nothing to burn");
    return { week, burned: 0n, txSig: null, applied: false };
  }

  // Burn on-chain FIRST — the ledger leg only posts after a confirmed signature,
  // so a chain failure leaves the pool intact for next week (no IOU).
  const txSig = await ctx.chain.burnFromCustody(pool);

  const posted = await ctx.ledger.postTransaction(
    [
      { accountId: ctx.accounts.burn_pool, delta: -pool },
      { accountId: ctx.accounts.burned, delta: pool },
    ],
    { idempotencyKey: `weekly-burn:${week}`, refType: "weekly_burn", refId: week },
  );

  if (!posted.applied) {
    // Already burned this week (replay). The on-chain burn above would be a
    // double-burn — guard: this path should not be reached because the queue is
    // weekly + idempotent, but if it is, surface it loudly.
    ctx.log.warn({ week, txSig }, "weekly burn: ledger replay — week already burned");
    return { week, burned: 0n, txSig, applied: false };
  }

  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const breakdown = await burnBreakdown(ctx, weekStart);

  await ctx.db.insert(auditLog).values({
    actor: "worker",
    action: "weekly_burn",
    detail: { week, burned: pool.toString(), txSig, breakdown },
  });

  const lines = Object.entries(breakdown)
    .map(([k, v]) => `• ${k}: ${v}`)
    .join("\n");
  await postDiscord(
    ctx,
    opts.discordWebhookUrl,
    `🔥 **${week}: ${pool.toString()} base-unit $SHINY burned**\ntx: \`${txSig}\`\n${lines}\n_(draft — review before publishing)_`,
  );

  ctx.log.info({ week, burned: pool.toString(), txSig }, "weekly burn executed");
  return { week, burned: pool, txSig, applied: true };
}
