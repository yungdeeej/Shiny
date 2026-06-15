/**
 * Weekly burn with a fake provider: burns the pool balance once, ledger stays
 * conserved (sums to 0), idempotent per ISO week.
 */
import { afterEach, describe, expect, it } from "vitest";
import { auditLog } from "@trash-wars/db";
import type { AppContext } from "@trash-wars/api/core";
import { eq } from "../orm.js";
import { executeWeeklyBurn, isoWeekKey } from "../jobs/weekly-burn.js";
import { buildWorkerTestContext, ledgerTotal, FakeChainProvider } from "./helpers.js";

let ctx: AppContext;
afterEach(async () => {
  if (ctx) await ctx.close();
});

/** Move `amount` into burn_pool (from the mirror) to simulate a week of activity. */
async function fundBurnPool(c: AppContext, amount: bigint): Promise<void> {
  await c.ledger.postTransaction(
    [
      { accountId: c.accounts.burn_pool, delta: amount },
      { accountId: c.accounts.onchain_reserve_mirror, delta: -amount },
    ],
    { idempotencyKey: `fund-burn:${amount}`, refType: "mint", refId: "test" },
  );
}

describe("weekly burn", () => {
  it("burns the whole pool once and conserves the ledger", async () => {
    const fake = new FakeChainProvider();
    ctx = await buildWorkerTestContext(fake);
    await fundBurnPool(ctx, 14_200_000n);

    const res = await executeWeeklyBurn(ctx);
    expect(res.applied).toBe(true);
    expect(res.burned).toBe(14_200_000n);
    expect(res.txSig).toMatch(/^FAKE-BURN/);
    expect(fake.countOf("burnFromCustody")).toBe(1);

    // burn_pool drained to terminal `burned`; ledger still sums to zero.
    expect(await ctx.ledger.getBalance(ctx.accounts.burn_pool)).toBe(0n);
    expect(await ctx.ledger.getBalance(ctx.accounts.burned)).toBe(14_200_000n);
    expect(await ledgerTotal(ctx)).toBe(0n);

    const audit = await ctx.db.select().from(auditLog).where(eq(auditLog.action, "weekly_burn"));
    expect(audit.length).toBe(1);
    expect((audit[0]!.detail as { week: string }).week).toBe(isoWeekKey());
  });

  it("is idempotent per ISO week (second run burns nothing)", async () => {
    const fake = new FakeChainProvider();
    ctx = await buildWorkerTestContext(fake);
    await fundBurnPool(ctx, 1_000n);
    await executeWeeklyBurn(ctx);

    // Re-fund, then re-run the SAME week → ledger key already used → no-op leg.
    await fundBurnPool(ctx, 2_000n);
    const again = await executeWeeklyBurn(ctx);
    expect(again.applied).toBe(false);
    // burned stays at the first week's amount; ledger conserved.
    expect(await ctx.ledger.getBalance(ctx.accounts.burned)).toBe(1_000n);
    expect(await ledgerTotal(ctx)).toBe(0n);
  });

  it("no-ops on an empty pool (no chain burn)", async () => {
    const fake = new FakeChainProvider();
    ctx = await buildWorkerTestContext(fake);
    const res = await executeWeeklyBurn(ctx);
    expect(res.applied).toBe(false);
    expect(res.burned).toBe(0n);
    expect(fake.countOf("burnFromCustody")).toBe(0);
  });
});
