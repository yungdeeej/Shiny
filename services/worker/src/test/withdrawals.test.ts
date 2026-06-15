/**
 * Withdrawal payout job with a fake provider:
 *  - confirmed sig → ledger leg posts once, row → sent with tx_sig
 *  - provider throws → row failed, NO ledger reversal, no double-post on retry
 *  - hot wallet < next payout → queue paused + incident raised
 */
import { afterEach, describe, expect, it } from "vitest";
import { users, withdrawals, incidents } from "@trash-wars/db";
import { getUserAccount, setKv, type AppContext } from "@trash-wars/api/core";
import { eq } from "../orm.js";
import { runWithdrawalPayouts } from "../jobs/withdrawals.js";
import { buildWorkerTestContext, ledgerTotal, FakeChainProvider } from "./helpers.js";

let ctx: AppContext;

afterEach(async () => {
  if (ctx) await ctx.close();
});

/** Seed a user with a queued withdrawal whose payable leg is already posted. */
async function seedQueuedWithdrawal(
  c: AppContext,
  amount: bigint,
  fee: bigint,
): Promise<{ id: string; userId: string }> {
  const u = await c.db.insert(users).values({ handle: `wd_${Math.random()}`, isGuest: true }).returning();
  const userId = u[0]!.id;
  const account = await getUserAccount(c.ledger, userId);
  const net = amount - fee;
  // Mirror the API withdraw leg: fund the user first, then move to payable.
  await c.ledger.postTransaction(
    [
      { accountId: c.accounts.onchain_reserve_mirror, delta: -amount },
      { accountId: account, delta: amount },
    ],
    { idempotencyKey: `seed-fund:${userId}`, refType: "test", refId: userId },
  );
  const id = crypto.randomUUID();
  await c.ledger.postTransaction(
    [
      { accountId: account, delta: -amount },
      { accountId: c.accounts.treasury, delta: fee },
      { accountId: c.accounts.withdrawals_payable, delta: net },
    ],
    { idempotencyKey: `withdraw:${id}`, refType: "withdrawal", refId: id },
  );
  await c.db.insert(withdrawals).values({ id, userId, amount, fee, destAddress: "Dest1111", state: "queued" });
  return { id, userId };
}

describe("withdrawal payout job", () => {
  it("posts the payable→mirror leg once and marks the row sent", async () => {
    const fake = new FakeChainProvider();
    ctx = await buildWorkerTestContext(fake);
    const { id } = await seedQueuedWithdrawal(ctx, 10_000n, 500n);

    await runWithdrawalPayouts(ctx);

    const row = (await ctx.db.select().from(withdrawals).where(eq(withdrawals.id, id)))[0]!;
    expect(row.state).toBe("sent");
    expect(row.txSig).toMatch(/^FAKE-WD/);
    expect(fake.countOf("payWithdrawal")).toBe(1);
    expect(await ctx.ledger.getBalance(ctx.accounts.withdrawals_payable)).toBe(0n);
    expect(await ledgerTotal(ctx)).toBe(0n);

    // Re-run: idempotent — no second payout, no second ledger leg.
    await runWithdrawalPayouts(ctx);
    expect(fake.countOf("payWithdrawal")).toBe(1);
    expect(await ledgerTotal(ctx)).toBe(0n);
  });

  it("provider failure → row failed, no ledger reversal, no double-post on retry", async () => {
    const fake = new FakeChainProvider();
    fake.failOps.add("payWithdrawal");
    ctx = await buildWorkerTestContext(fake);
    const { id } = await seedQueuedWithdrawal(ctx, 10_000n, 500n);
    const payableBefore = await ctx.ledger.getBalance(ctx.accounts.withdrawals_payable);

    await runWithdrawalPayouts(ctx);

    const row = (await ctx.db.select().from(withdrawals).where(eq(withdrawals.id, id)))[0]!;
    expect(row.state).toBe("failed");
    // Payable is untouched — net was NOT moved back (no auto-reversal).
    expect(await ctx.ledger.getBalance(ctx.accounts.withdrawals_payable)).toBe(payableBefore);
    expect(await ledgerTotal(ctx)).toBe(0n);

    // Retry: the failed row is not re-attempted (only `queued` rows are picked).
    await runWithdrawalPayouts(ctx);
    expect(fake.countOf("payWithdrawal")).toBe(1);
  });

  it("pauses the queue and raises an incident when the hot wallet can't cover", async () => {
    const fake = new FakeChainProvider();
    fake.reserves = { hotWallet: 100n, multisig: 0n }; // far below the 9_500 net
    ctx = await buildWorkerTestContext(fake);
    await seedQueuedWithdrawal(ctx, 10_000n, 500n);

    await runWithdrawalPayouts(ctx);

    // No payout attempted; queue paused; incident logged.
    expect(fake.countOf("payWithdrawal")).toBe(0);
    const inc = await ctx.db.select().from(incidents).where(eq(incidents.kind, "hot_wallet_insufficient"));
    expect(inc.length).toBeGreaterThanOrEqual(1);

    // Clean the flag for context teardown hygiene.
    await setKv(ctx.db, "withdrawals_paused", false);
  });
});
