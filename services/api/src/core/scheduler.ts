/**
 * All periodic logic as pure-ish tick functions sharing one source of truth.
 * - No REDIS_URL → startInProcessScheduler() runs them on intervals inside the API.
 * - REDIS_URL set → services/worker runs the same TICKS via BullMQ repeatable jobs.
 */
import { SEASON1 } from "@trash-wars/economy";
import { TIER_DEFINITIONS, credTier } from "@trash-wars/shared";
import {
  auditLog,
  characters,
  incidents,
  locations,
  patrols,
  pdDistributions,
  pendingChanges,
  raffles,
  raffleWeeklyGrants,
  reservesSnapshots,
  tierDefinitions,
  users,
  withdrawals,
} from "@trash-wars/db";
import { and, eq, gt, gte, inArray, lte, sql } from "./orm.js";
import type { AppContext } from "./context.js";
import { settleDueMissions } from "./settle.js";
import { addRaffleTickets, drawDueRaffles } from "./raffles.js";
import { getFlag, getKv, setKv } from "./config.js";
import { getUserAccount, sumBalanceByKinds } from "./accounts.js";
import { resolveTier } from "./tiers.js";
import { utcDayKey } from "./time.js";

/* ── mission / patrol / raffle sweeps ─────────────────────────────── */

export async function tickSettleMissions(ctx: AppContext): Promise<void> {
  await settleDueMissions(ctx);
}

export async function tickRaffleDraws(ctx: AppContext): Promise<void> {
  await drawDueRaffles(ctx);
}

export async function tickPatrolShifts(ctx: AppContext, now = new Date()): Promise<void> {
  const ended = await ctx.db
    .update(patrols)
    .set({ active: false })
    .where(and(eq(patrols.active, true), lte(patrols.shiftEnd, now)))
    .returning({ characterId: patrols.characterId, locationSlug: patrols.locationSlug });
  for (const patrol of ended) {
    const rows = await ctx.db
      .update(characters)
      .set({ status: "idle" })
      .where(and(eq(characters.id, patrol.characterId), eq(characters.status, "on_patrol")))
      .returning({ ownerUserId: characters.ownerUserId });
    const owner = rows[0]?.ownerUserId;
    if (owner) {
      ctx.bus.emitUser(owner, {
        type: "patrol_ended",
        characterId: patrol.characterId,
        locationSlug: patrol.locationSlug,
      });
    }
  }
}

/* ── bank ─────────────────────────────────────────────────────────── */

export async function tickWithdrawals(ctx: AppContext, now = new Date()): Promise<void> {
  if (await getFlag(ctx.db, "withdrawals_paused")) return;

  const dayStart = new Date(`${utcDayKey(now)}T00:00:00.000Z`);
  const sentRows = await ctx.db
    .select({ v: sql<string>`coalesce(sum(${withdrawals.amount}), 0)::text` })
    .from(withdrawals)
    .where(and(eq(withdrawals.state, "sent"), gte(withdrawals.processedAt, dayStart)));
  let sentToday = BigInt(sentRows[0]?.v ?? "0");

  const queue = await ctx.db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.state, "queued"))
    .orderBy(withdrawals.createdAt)
    .limit(50);

  for (const wd of queue) {
    if (sentToday + wd.amount > ctx.env.globalDailyWithdrawalCap) break;
    const net = wd.amount - wd.fee;
    try {
      const txSig = await ctx.chain.payWithdrawal(wd.destAddress, net);
      // Net leaves the in-game ledger world back to the on-chain mirror.
      await ctx.ledger.postTransaction(
        [
          { accountId: ctx.accounts.withdrawals_payable, delta: -net },
          { accountId: ctx.accounts.onchain_reserve_mirror, delta: net },
        ],
        { idempotencyKey: `withdraw-pay:${wd.id}`, refType: "withdrawal_paid", refId: wd.id },
      );
      await ctx.db
        .update(withdrawals)
        .set({ state: "sent", txSig, processedAt: now })
        .where(and(eq(withdrawals.id, wd.id), eq(withdrawals.state, "queued")));
      sentToday += wd.amount;
      ctx.bus.emitUser(wd.userId, { type: "withdrawal_update", id: wd.id, state: "sent", txSig });
    } catch (err) {
      ctx.log.error({ err, withdrawalId: wd.id }, "withdrawal payout failed");
      await ctx.db
        .update(withdrawals)
        .set({ state: "failed", reason: String(err) })
        .where(and(eq(withdrawals.id, wd.id), eq(withdrawals.state, "queued")));
    }
  }
}

export async function tickProofOfReserves(ctx: AppContext, now = new Date()): Promise<void> {
  const { hotWallet, multisig } = await ctx.chain.getReserves();
  const liabilities = await sumBalanceByKinds(ctx.db, ["game_balance", "withdrawals_payable"]);
  const healthy = hotWallet + multisig >= liabilities;
  await ctx.db.insert(reservesSnapshots).values({
    at: now,
    onchainHot: hotWallet,
    onchainMultisig: multisig,
    liabilities,
    healthy,
  });
  if (!healthy) {
    await setKv(ctx.db, "withdrawals_paused", true);
    await ctx.db.insert(incidents).values({
      kind: "reserves_unhealthy",
      severity: "critical",
      detail: {
        hotWallet: hotWallet.toString(),
        multisig: multisig.toString(),
        liabilities: liabilities.toString(),
      },
    });
    ctx.log.error("proof-of-reserves UNHEALTHY — withdrawals paused");
  }
}

/* ── daily (game-day) ticks ───────────────────────────────────────── */

async function seasonStartMs(ctx: AppContext): Promise<number> {
  const iso = await getKv<string>(ctx.db, "season_start");
  return iso ? Date.parse(iso) : Date.now();
}

export async function tickEmissionsTopup(ctx: AppContext, now = new Date()): Promise<void> {
  const dayIndex = ctx.clock.gameDayIndex(await seasonStartMs(ctx), now.getTime());
  const last = (await getKv<number>(ctx.db, "emissions_last_topup_day")) ?? -1;
  if (dayIndex <= last) return;
  await ctx.ledger.postTransaction(
    [
      { accountId: ctx.accounts.emissions_reserve, delta: -SEASON1.dailyBudget },
      { accountId: ctx.accounts.emissions_budget, delta: SEASON1.dailyBudget },
    ],
    {
      idempotencyKey: `emissions-topup:${dayIndex}`,
      refType: "emissions_topup",
      refId: String(dayIndex),
    },
  );
  await setKv(ctx.db, "emissions_last_topup_day", dayIndex);
}

const PD_DISTRIBUTION_BPS = 8_000n; // distribute 80%, keep 20% buffer
const REP_YIELD_BPS_PER_LEVEL = 2_500n; // weight = 1 + rep*0.25, in bps

export async function tickPdDistribution(ctx: AppContext, now = new Date()): Promise<void> {
  const dayIndex = ctx.clock.gameDayIndex(await seasonStartMs(ctx), now.getTime());
  const last = (await getKv<number>(ctx.db, "pd_last_dist_day")) ?? dayIndex;
  if (dayIndex <= last) {
    if ((await getKv<number>(ctx.db, "pd_last_dist_day")) === undefined) {
      await setKv(ctx.db, "pd_last_dist_day", dayIndex);
    }
    return;
  }

  const pool = await ctx.ledger.getBalance(ctx.accounts.pd_pool);
  const hounds = await ctx.db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.faction, "bloodhound"),
        eq(characters.inGame, true),
        sql`${characters.status} <> 'dead'`,
      ),
    );

  if (pool > 0n && hounds.length > 0) {
    const distributable = (pool * PD_DISTRIBUTION_BPS) / 10_000n;
    const weights = hounds.map(
      (h) => 10_000n + BigInt(h.stats.reputation) * REP_YIELD_BPS_PER_LEVEL,
    );
    const totalWeight = weights.reduce((s, w) => s + w, 0n);
    const perOwner = new Map<string, bigint>();
    hounds.forEach((h, i) => {
      const share = (distributable * weights[i]!) / totalWeight;
      if (share > 0n) {
        perOwner.set(h.ownerUserId, (perOwner.get(h.ownerUserId) ?? 0n) + share);
      }
    });
    let distributed = 0n;
    for (const v of perOwner.values()) distributed += v;

    if (distributed > 0n) {
      const entries = [{ accountId: ctx.accounts.pd_pool, delta: -distributed }];
      for (const [ownerId, share] of perOwner) {
        entries.push({ accountId: await getUserAccount(ctx.ledger, ownerId), delta: share });
      }
      const posted = await ctx.ledger.postTransaction(entries, {
        idempotencyKey: `pd-dist:${dayIndex}`,
        refType: "pd_distribution",
        refId: String(dayIndex),
      });
      if (posted.applied) {
        // Note: pd_distributions.day is UNIQUE on the real date; at high time scales
        // only the first game-day distribution of a real day records a row.
        await ctx.db
          .insert(pdDistributions)
          .values({
            day: utcDayKey(now),
            poolSnapshot: pool,
            distributed,
            recipients: perOwner.size,
          })
          .onConflictDoNothing();
        for (const ownerId of perOwner.keys()) {
          ctx.bus.emitUser(ownerId, { type: "pd_distribution", day: dayIndex });
        }
      }
    }
  }
  await setKv(ctx.db, "pd_last_dist_day", dayIndex);
}

/* ── v1.1 Street Cred ticks (specs/01) ───────────────────────────── */

/** Daily tier snapshot: re-resolve every user's tier from on-chain holdings. */
export async function tickTierSnapshots(ctx: AppContext, now = new Date()): Promise<void> {
  const dayIndex = ctx.clock.gameDayIndex(await seasonStartMs(ctx), now.getTime());
  const last = await getKv<number>(ctx.db, "tier_last_snapshot_day");
  if (last !== undefined && dayIndex <= last) return;
  const userRows = await ctx.db.select({ id: users.id }).from(users);
  for (const u of userRows) {
    try {
      await resolveTier(ctx, u.id, { force: true, now });
    } catch (err) {
      ctx.log.error({ err, userId: u.id }, "tier snapshot failed");
    }
  }
  await setKv(ctx.db, "tier_last_snapshot_day", dayIndex);
}

/** ISO-8601 week key, e.g. 2026-W24 (UTC). */
export function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Shift to the Thursday of this week — ISO weeks belong to the year of their Thursday.
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Borough+ weekly raffle ticket (specs/01): one free ticket per ISO week into
 * the earliest open recruitment raffle. Ledger-free grant; idempotent per
 * (user, week) via raffle_weekly_grants' unique constraint.
 */
export async function tickWeeklyRaffleGrants(ctx: AppContext, now = new Date()): Promise<void> {
  const week = isoWeekKey(now);
  const eligibleTiers = credTier.options.filter(
    (t) => TIER_DEFINITIONS[t].perks.weeklyRaffleTickets > 0,
  );
  const eligible = await ctx.db
    .select({ id: users.id, tier: users.currentTier })
    .from(users)
    .where(inArray(users.currentTier, eligibleTiers));
  if (eligible.length === 0) return;

  const open = await ctx.db
    .select()
    .from(raffles)
    .where(and(eq(raffles.state, "open"), eq(raffles.type, "recruitment"), gt(raffles.drawsAt, now)))
    .orderBy(raffles.drawsAt)
    .limit(1);
  const raffle = open[0];
  if (!raffle) return;

  for (const user of eligible) {
    const inserted = await ctx.db
      .insert(raffleWeeklyGrants)
      .values({ userId: user.id, week, raffleId: raffle.id })
      .onConflictDoNothing({ target: [raffleWeeklyGrants.userId, raffleWeeklyGrants.week] })
      .returning({ id: raffleWeeklyGrants.id });
    if (!inserted[0]) continue; // already granted this week
    const tickets = TIER_DEFINITIONS[credTier.parse(user.tier)].perks.weeklyRaffleTickets;
    await addRaffleTickets(ctx, raffle.id, user.id, tickets);
    await ctx.db.insert(auditLog).values({
      actor: "system",
      action: "weekly_raffle_grant",
      detail: { userId: user.id, raffleId: raffle.id, week, tickets },
    });
  }
}

/* ── admin ratchet timelock ───────────────────────────────────────── */

export async function tickPendingChanges(ctx: AppContext, now = new Date()): Promise<void> {
  const due = await ctx.db
    .select()
    .from(pendingChanges)
    .where(and(eq(pendingChanges.applied, false), lte(pendingChanges.effectiveAt, now)));
  for (const change of due) {
    if (change.key.startsWith("location:")) {
      const slug = change.key.slice("location:".length);
      await ctx.db
        .update(locations)
        .set({ config: change.value as Record<string, unknown> })
        .where(eq(locations.slug, slug));
    } else if (change.key.startsWith("tier:")) {
      // v1.1 (specs/01): tier threshold lands after its 7-day public notice.
      const tier = change.key.slice("tier:".length);
      await ctx.db
        .update(tierDefinitions)
        .set({ minBalance: BigInt(String(change.value)) })
        .where(eq(tierDefinitions.tier, tier));
    } else {
      await setKv(ctx.db, change.key, change.value);
    }
    await ctx.db
      .update(pendingChanges)
      .set({ applied: true })
      .where(eq(pendingChanges.id, change.id));
    ctx.log.info({ key: change.key }, "applied timelocked config change");
  }
}

/* ── registry + in-process scheduler ──────────────────────────────── */

export type TickName =
  | "settleMissions"
  | "patrolShifts"
  | "raffleDraws"
  | "withdrawals"
  | "proofOfReserves"
  | "emissionsTopup"
  | "pdDistribution"
  | "pendingChanges"
  | "tierSnapshots"
  | "weeklyRaffleGrants";

export const TICKS: Record<TickName, (ctx: AppContext) => Promise<void>> = {
  settleMissions: tickSettleMissions,
  patrolShifts: (ctx) => tickPatrolShifts(ctx),
  raffleDraws: tickRaffleDraws,
  withdrawals: (ctx) => tickWithdrawals(ctx),
  proofOfReserves: (ctx) => tickProofOfReserves(ctx),
  emissionsTopup: (ctx) => tickEmissionsTopup(ctx),
  pdDistribution: (ctx) => tickPdDistribution(ctx),
  pendingChanges: (ctx) => tickPendingChanges(ctx),
  tierSnapshots: (ctx) => tickTierSnapshots(ctx),
  weeklyRaffleGrants: (ctx) => tickWeeklyRaffleGrants(ctx),
};

export function tickIntervalsMs(env: { beta: boolean }): Record<TickName, number> {
  return {
    settleMissions: 15_000,
    patrolShifts: 15_000,
    raffleDraws: 15_000,
    withdrawals: env.beta ? 30_000 : 30 * 60_000,
    proofOfReserves: env.beta ? 30_000 : 10 * 60_000,
    emissionsTopup: 60_000,
    pdDistribution: 60_000,
    pendingChanges: 60_000,
    tierSnapshots: 60_000,
    weeklyRaffleGrants: env.beta ? 60_000 : 10 * 60_000,
  };
}

/** Beta path: run every tick on an interval inside the API process. */
export function startInProcessScheduler(ctx: AppContext): () => void {
  const timers: NodeJS.Timeout[] = [];
  const intervals = tickIntervalsMs(ctx.env);
  for (const name of Object.keys(TICKS) as TickName[]) {
    const run = () =>
      TICKS[name](ctx).catch((err) => ctx.log.error({ err, tick: name }, "tick failed"));
    void run();
    const timer = setInterval(run, intervals[name]);
    timer.unref?.();
    timers.push(timer);
  }
  ctx.log.info("in-process scheduler started (no REDIS_URL — beta mode)");
  return () => {
    for (const t of timers) clearInterval(t);
  };
}
