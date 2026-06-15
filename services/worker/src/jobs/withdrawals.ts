/**
 * Worker-side withdrawal payout wrapper.
 *
 * The actual ledger + state machine lives in the shared scheduler tick
 * (`tickWithdrawals`): it calls `ctx.chain.payWithdrawal`, posts the
 * `withdrawals_payable → onchain_reserve_mirror` leg ONLY after a confirmed
 * signature (idempotency `withdraw-pay:{id}`), marks the row `sent` with the tx
 * sig, and on chain failure marks `failed` with NO ledger reversal.
 *
 * This wrapper adds the custody preflight the worker owns: if the hot wallet
 * cannot cover the next queued payout, pause the queue (set the kill-switch flag
 * the API already honours) and raise an incident, rather than letting each
 * payout fail one by one.
 */
import { eq } from "../orm.js";
import { withdrawals } from "@trash-wars/db";
import { tickWithdrawals, setKv, getFlag, type AppContext } from "@trash-wars/api/core";
import { raiseIncident } from "../alerts.js";

export interface WithdrawalTickOptions {
  discordWebhookUrl?: string;
}

export async function runWithdrawalPayouts(
  ctx: AppContext,
  opts: WithdrawalTickOptions = {},
): Promise<void> {
  if (await getFlag(ctx.db, "withdrawals_paused")) return;

  // Peek the next queued payout and the hot-wallet on-chain balance.
  const next = await ctx.db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.state, "queued"))
    .orderBy(withdrawals.createdAt)
    .limit(1);
  const head = next[0];
  if (head) {
    const net = head.amount - head.fee;
    const { hotWallet } = await ctx.chain.getReserves();
    if (hotWallet < net) {
      await setKv(ctx.db, "withdrawals_paused", true);
      await raiseIncident(
        ctx,
        "hot_wallet_insufficient",
        "critical",
        {
          nextWithdrawalId: head.id,
          required: net.toString(),
          hotWallet: hotWallet.toString(),
        },
        opts.discordWebhookUrl,
      );
      return;
    }
  }

  await tickWithdrawals(ctx);
}
