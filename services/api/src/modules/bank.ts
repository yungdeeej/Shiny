/** Bank module: deposits (beta = instant credit), withdrawals, proof of reserves. */
import { randomUUID } from "node:crypto"
import type { FastifyInstance } from "fastify";
import { isValidSolanaAddress } from "@trash-wars/chain";
import {
  applyBps,
  depositIntentRequest,
  withdrawRequest,
  type ProofOfReserves,
  type Withdrawal,
} from "@trash-wars/shared";
import {
  depositMemos,
  deposits,
  reservesSnapshots,
  sybilFlags,
  withdrawals,
} from "@trash-wars/db";
import { and, desc, eq, gte, inArray, sql } from "../core/orm.js";
import { badRequest, conflict, insufficientFunds, notImplemented, unauthorized } from "../core/errors.js";
import { getFlag } from "../core/config.js";
import { getUserAccount, unlockedBalance } from "../core/accounts.js";
import { newMemoCode } from "../core/bootstrap.js";
import { tickProofOfReserves } from "../core/scheduler.js";
import { resolveTier } from "../core/tiers.js";
import { utcDayKey } from "../core/time.js";
import { complianceGate, requireNotFrozen, requireTos } from "./session.js";

const SHINY_DECIMALS = 6;

interface ParsedDeposit {
  txSig: string;
  amount: bigint; // base units
  memo: string | null;
}

/**
 * Parse a Helius webhook body into SHINY deposits credited to the deposit
 * address owner. Supports the "enhanced" shape (array of objects with
 * tokenTransfers[]) and a raw fallback (flat {signature, amount, memo}).
 *
 * For each SPL transfer where mint == SHINY_MINT and the destination owner
 * (toUserAccount) == depositAddress, we read the transaction memo and emit one
 * ParsedDeposit. Amounts come from rawTokenAmount (base units) when present,
 * else the decimal tokenAmount scaled by SHINY_DECIMALS.
 */
export function parseHeliusDeposits(
  body: unknown,
  shinyMint: string | undefined,
  depositAddress: string,
): ParsedDeposit[] {
  if (!Array.isArray(body)) return [];
  const out: ParsedDeposit[] = [];

  for (const raw of body as Array<Record<string, unknown>>) {
    const txSig = String(raw.signature ?? "");
    if (!txSig) continue;
    const memo = extractMemo(raw);

    const tokenTransfers = raw.tokenTransfers;
    if (Array.isArray(tokenTransfers) && tokenTransfers.length > 0) {
      // Enhanced shape.
      for (const tr of tokenTransfers as Array<Record<string, unknown>>) {
        const mint = String(tr.mint ?? "");
        const to = String(tr.toUserAccount ?? tr.toTokenAccount ?? "");
        if (shinyMint && mint !== shinyMint) continue;
        if (to !== depositAddress) continue;
        const amount = transferAmount(tr);
        if (amount <= 0n) continue;
        out.push({ txSig, amount, memo });
      }
    } else {
      // Raw fallback: flat {signature, amount, memo, mint?, destination?}.
      const mint = raw.mint ? String(raw.mint) : null;
      const dest = raw.destination ? String(raw.destination) : null;
      if (shinyMint && mint && mint !== shinyMint) continue;
      if (dest && dest !== depositAddress) continue;
      const amount = BigInt(String(raw.amount ?? "0"));
      if (amount <= 0n) continue;
      out.push({ txSig, amount, memo });
    }
  }
  return out;
}

/** Base-unit amount from a Helius enhanced tokenTransfer leg. */
function transferAmount(tr: Record<string, unknown>): bigint {
  const rawAmt = tr.rawTokenAmount as Record<string, unknown> | undefined;
  if (rawAmt && rawAmt.tokenAmount !== undefined) {
    return BigInt(String(rawAmt.tokenAmount));
  }
  // tokenAmount is a UI (decimal) amount — scale by SHINY_DECIMALS.
  const ui = tr.tokenAmount;
  if (ui === undefined) return 0n;
  return uiToBaseUnits(String(ui), SHINY_DECIMALS);
}

/** Convert a decimal-string token amount to base units without floats. */
function uiToBaseUnits(ui: string, decimals: number): bigint {
  const neg = ui.startsWith("-");
  const clean = neg ? ui.slice(1) : ui;
  const [whole, frac = ""] = clean.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const base = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  return neg ? -base : base;
}

/** Pull the memo from Helius enhanced fields (instructions / description). */
function extractMemo(raw: Record<string, unknown>): string | null {
  // Top-level convenience field if the relayer attaches one.
  if (typeof raw.memo === "string" && raw.memo.length > 0) return raw.memo;
  // Memo-program instruction (parsed) — scan instructions for the memo program.
  const instructions = raw.instructions;
  if (Array.isArray(instructions)) {
    for (const ix of instructions as Array<Record<string, unknown>>) {
      const programId = String(ix.programId ?? "");
      if (programId === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" && typeof ix.data === "string") {
        return ix.data;
      }
    }
  }
  return null;
}

function withdrawalToApi(w: typeof withdrawals.$inferSelect): Withdrawal {
  return {
    id: w.id,
    amount: w.amount.toString(),
    fee: w.fee.toString(),
    net: (w.amount - w.fee).toString(),
    destAddress: w.destAddress,
    state: w.state,
    txSig: w.txSig,
    createdAt: w.createdAt.toISOString(),
  };
}

export default async function bankModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.post("/bank/deposit-intent", async (request) => {
    const user = requireNotFrozen(requireTos(request));
    await complianceGate(ctx, request, "deposit");
    if (await getFlag(ctx.db, "deposits_paused")) {
      throw conflict("DEPOSITS_PAUSED", "deposits are paused");
    }
    const { amount } = depositIntentRequest.parse(request.body);
    const value = BigInt(amount);
    if (value <= 0n) throw badRequest("BAD_AMOUNT", "amount must be positive");

    // Get-or-create the user's permanent memo attribution code.
    const existing = await ctx.db
      .select()
      .from(depositMemos)
      .where(eq(depositMemos.userId, user.id))
      .limit(1);
    let memo = existing[0]?.memo;
    if (!memo) {
      memo = newMemoCode();
      await ctx.db.insert(depositMemos).values({ userId: user.id, memo });
    }

    if (ctx.env.beta) {
      // Beta: simulate instant finality — credit immediately.
      const txSig = `BETA-DEP-${randomUUID()}`;
      await ctx.db.insert(deposits).values({
        userId: user.id,
        txSig,
        amount: value,
        state: "credited",
        memo,
      });
      const account = await getUserAccount(ctx.ledger, user.id);
      await ctx.ledger.postTransaction(
        [
          { accountId: ctx.accounts.onchain_reserve_mirror, delta: -value },
          { accountId: account, delta: value },
        ],
        { idempotencyKey: `deposit:${txSig}`, refType: "deposit", refId: txSig },
      );
    }

    return { depositAddress: ctx.env.depositAddress, memo, serializedTx: null };
  });

  app.post("/webhooks/helius", async (request, reply) => {
    if (ctx.env.beta) throw notImplemented("helius ingestion is disabled in beta mode");
    const auth = request.headers["authorization"];
    if (!ctx.env.heliusWebhookSecret || auth !== ctx.env.heliusWebhookSecret) {
      throw unauthorized("bad webhook secret");
    }

    // Parse the Helius payload into our SHINY-deposit shape (enhanced + raw fallback).
    const transfers = parseHeliusDeposits(request.body, ctx.env.shinyMint, ctx.env.depositAddress);
    let credited = 0;
    let unattributed = 0;

    for (const t of transfers) {
      // Look up the memo → user. Memo-less / unknown memos land 'unattributed'.
      const memoRow = t.memo
        ? (await ctx.db.select().from(depositMemos).where(eq(depositMemos.memo, t.memo)).limit(1))[0]
        : undefined;

      // Insert keyed by tx signature — UNIQUE makes redelivery idempotent (a 5×
      // replay credits exactly once: only the first insert returns a row).
      const inserted = await ctx.db
        .insert(deposits)
        .values({
          userId: memoRow?.userId ?? null,
          txSig: t.txSig,
          amount: t.amount,
          state: memoRow ? "credited" : "unattributed",
          memo: t.memo,
        })
        .onConflictDoNothing({ target: deposits.txSig })
        .returning();
      if (!inserted[0]) continue; // already processed this signature

      if (!memoRow) {
        unattributed += 1;
        continue; // admin assigns later; no ledger credit
      }

      // Finalized SHINY in → mirror balance moves into the user's game balance.
      const account = await getUserAccount(ctx.ledger, memoRow.userId);
      await ctx.ledger.postTransaction(
        [
          { accountId: ctx.accounts.onchain_reserve_mirror, delta: -t.amount },
          { accountId: account, delta: t.amount },
        ],
        { idempotencyKey: `deposit:${t.txSig}`, refType: "deposit", refId: t.txSig },
      );
      credited += 1;
    }
    return reply.send({ ok: true, credited, unattributed });
  });

  app.post("/bank/withdraw", async (request) => {
    const user = requireNotFrozen(requireTos(request));
    await complianceGate(ctx, request, "withdraw");
    if (await getFlag(ctx.db, "withdrawals_paused")) {
      throw conflict("WITHDRAWALS_PAUSED", "withdrawals are paused");
    }
    const body = withdrawRequest.parse(request.body);
    const amount = BigInt(body.amount);
    if (amount < ctx.env.minWithdrawal) {
      throw badRequest("BELOW_MINIMUM", `minimum withdrawal is ${ctx.env.minWithdrawal}`);
    }
    if (!ctx.env.beta && !isValidSolanaAddress(body.destAddress)) {
      throw badRequest("BAD_ADDRESS", "invalid destination address");
    }
    if (body.destAddress.length === 0) throw badRequest("BAD_ADDRESS", "destination required");

    const balances = await unlockedBalance(ctx.db, ctx.ledger, user.id);
    if (balances.unlocked < amount) {
      throw insufficientFunds(
        `unlocked balance ${balances.unlocked} < ${amount} (${balances.locked} locked in missions)`,
      );
    }

    // v1.1 (specs/01): withdrawal fee bps = f(Street Cred tier) — 5% base,
    // 4% District, 3% Borough, 2% Kingpin. Bigint floor semantics via applyBps.
    const cred = await resolveTier(ctx, user.id);
    const fee = applyBps(amount, cred.perks.withdrawalFeeBps);
    const net = amount - fee;
    const id = randomUUID();

    const account = await getUserAccount(ctx.ledger, user.id);
    await ctx.ledger.postTransaction(
      [
        { accountId: account, delta: -amount },
        { accountId: ctx.accounts.treasury, delta: fee },
        { accountId: ctx.accounts.withdrawals_payable, delta: net },
      ],
      { idempotencyKey: `withdraw:${id}`, refType: "withdrawal", refId: id },
    );

    // Review triggers: over the per-user auto-pay daily limit, or sybil/freeze flags.
    const dayStart = new Date(`${utcDayKey()}T00:00:00.000Z`);
    const todayRows = await ctx.db
      .select({ v: sql<string>`coalesce(sum(${withdrawals.amount}), 0)::text` })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.userId, user.id),
          gte(withdrawals.createdAt, dayStart),
          inArray(withdrawals.state, ["queued", "review", "sent"]),
        ),
      );
    const todayTotal = BigInt(todayRows[0]?.v ?? "0") + amount;
    const flags = await ctx.db
      .select()
      .from(sybilFlags)
      .where(eq(sybilFlags.userId, user.id))
      .limit(1);
    const needsReview = todayTotal > ctx.env.autoPayDailyLimit || flags.length > 0;

    const inserted = await ctx.db
      .insert(withdrawals)
      .values({
        id,
        userId: user.id,
        amount,
        fee,
        destAddress: body.destAddress,
        state: needsReview ? "review" : "queued",
        reason: needsReview ? "auto-review: daily limit or account flags" : null,
      })
      .returning();
    return withdrawalToApi(inserted[0]!);
  });

  app.get("/bank/withdrawals", async (request) => {
    const user = requireTos(request);
    const rows = await ctx.db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.userId, user.id))
      .orderBy(desc(withdrawals.createdAt))
      .limit(50);
    return rows.map(withdrawalToApi);
  });

  app.get("/bank/history", async (request) => {
    const user = requireTos(request);
    const [deps, wds] = await Promise.all([
      ctx.db
        .select()
        .from(deposits)
        .where(eq(deposits.userId, user.id))
        .orderBy(desc(deposits.createdAt))
        .limit(50),
      ctx.db
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.userId, user.id))
        .orderBy(desc(withdrawals.createdAt))
        .limit(50),
    ]);
    const merged = [
      ...deps.map((d) => ({
        kind: "deposit" as const,
        id: d.id,
        amount: d.amount.toString(),
        state: d.state,
        txSig: d.txSig,
        at: d.createdAt.toISOString(),
      })),
      ...wds.map((w) => ({
        kind: "withdrawal" as const,
        id: w.id,
        amount: w.amount.toString(),
        fee: w.fee.toString(),
        state: w.state,
        txSig: w.txSig,
        at: w.createdAt.toISOString(),
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
    return merged.slice(0, 50);
  });

  app.get("/public/proof-of-reserves", async () => {
    let history = await ctx.db
      .select()
      .from(reservesSnapshots)
      .orderBy(desc(reservesSnapshots.at))
      .limit(24);
    if (history.length === 0) {
      await tickProofOfReserves(ctx);
      history = await ctx.db
        .select()
        .from(reservesSnapshots)
        .orderBy(desc(reservesSnapshots.at))
        .limit(24);
    }
    const toApi = (s: typeof reservesSnapshots.$inferSelect): ProofOfReserves => {
      const reserves = s.onchainHot + s.onchainMultisig;
      return {
        at: s.at.toISOString(),
        onchainReserves: reserves.toString(),
        hotWallet: s.onchainHot.toString(),
        multisig: s.onchainMultisig.toString(),
        liabilities: s.liabilities.toString(),
        ratioBps:
          s.liabilities > 0n ? Number((reserves * 10_000n) / s.liabilities) : 10_000,
        healthy: s.healthy,
      };
    };
    return { latest: history[0] ? toApi(history[0]) : null, history: history.map(toApi) };
  });
}
