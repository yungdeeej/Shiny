/**
 * Season Pass core (v1.1, specs/02): XP ("Heat") accrual from existing game
 * events via the in-process bus, weekly challenge progress, and reward claims.
 *
 * Iron rule (doc 13 §4): rewards are cosmetics, insurance vouchers, raffle
 * fragments, nameplates — never $SHINY amounts, never stat effects. Nothing in
 * this module touches the ledger.
 *
 * Idempotency: XP sources emit ONLY on applied state changes (settlement emits
 * mission_resolved only when its ledger txn applied), so replays never
 * double-grant. Claims are exactly-once via pass_claims' unique constraint.
 */
import { PASS, type MissionOutcome } from "@trash-wars/shared";
import {
  configKv,
  passChallengeProgress,
  passChallenges,
  passProgress,
  seasonPasses,
  userCosmetics,
  users,
} from "@trash-wars/db";
import { and, eq, sql } from "./orm.js";
import type { AppContext } from "./context.js";
import type { UserEvent } from "./bus.js";
import { addToCounter, getCounter, getKv } from "./config.js";
import { utcDayKey } from "./time.js";

export const PASS_SEASON = 1;

export function levelForXp(xp: number): number {
  return Math.min(PASS.levels, Math.floor(xp / PASS.xpPerLevel));
}

/** Season week (0..12) from season_start in game time — drives challenge rotation. */
export async function currentSeasonWeek(ctx: AppContext, now = new Date()): Promise<number> {
  const iso = await getKv<string>(ctx.db, "season_start");
  const epoch = iso ? Date.parse(iso) : now.getTime();
  const day = ctx.clock.gameDayIndex(epoch, now.getTime());
  return Math.max(0, Math.min(12, Math.floor(day / 7)));
}

/** Add XP to the user's pass progress; recomputes level and emits level-up. */
export async function grantXp(
  ctx: AppContext,
  userId: string,
  amount: number,
  reason: string,
): Promise<void> {
  if (amount <= 0) return;
  const rows = await ctx.db
    .insert(passProgress)
    .values({ userId, season: PASS_SEASON, xp: amount, level: levelForXp(amount) })
    .onConflictDoUpdate({
      target: [passProgress.userId, passProgress.season],
      set: { xp: sql`${passProgress.xp} + ${amount}` },
    })
    .returning();
  const row = rows[0];
  if (!row) return;
  const level = levelForXp(row.xp);
  if (level !== row.level) {
    await ctx.db
      .update(passProgress)
      .set({ level })
      .where(eq(passProgress.id, row.id));
    if (level > row.level) {
      ctx.bus.emitUser(userId, { type: "pass_level_up", level, xp: row.xp, reason });
    }
  }
}

/** Bump matching weekly challenges; completing one grants its bonus XP once. */
async function bumpChallenges(
  ctx: AppContext,
  userId: string,
  kind: string,
  refSlug: string | null,
  increment: number,
  now: Date,
): Promise<void> {
  const week = await currentSeasonWeek(ctx, now);
  const challenges = await ctx.db
    .select()
    .from(passChallenges)
    .where(
      and(eq(passChallenges.season, PASS_SEASON), eq(passChallenges.week, week), eq(passChallenges.kind, kind)),
    );
  for (const challenge of challenges) {
    if (challenge.refSlug !== null && challenge.refSlug !== refSlug) continue;
    const rows = await ctx.db
      .insert(passChallengeProgress)
      .values({ userId, challengeId: challenge.id, progress: increment })
      .onConflictDoUpdate({
        target: [passChallengeProgress.userId, passChallengeProgress.challengeId],
        set: { progress: sql`${passChallengeProgress.progress} + ${increment}` },
      })
      .returning();
    const row = rows[0];
    if (!row || row.completedAt !== null || row.progress < challenge.target) continue;
    // Completion guard: only the updater that flips completed_at grants the XP.
    const completed = await ctx.db
      .update(passChallengeProgress)
      .set({ completedAt: now })
      .where(and(eq(passChallengeProgress.id, row.id), sql`${passChallengeProgress.completedAt} is null`))
      .returning({ id: passChallengeProgress.id });
    if (completed[0]) {
      await grantXp(ctx, userId, challenge.xp, `challenge:${challenge.slug}`);
    }
  }
}

const SURVIVE_OUTCOMES = new Set<MissionOutcome>(["win", "jackpot", "nothing"]);
const WIN_OUTCOMES = new Set<MissionOutcome>(["win", "jackpot"]);

async function handleEvent(ctx: AppContext, userId: string, event: UserEvent): Promise<void> {
  const now = new Date();
  const day = utcDayKey(now);
  switch (event.type) {
    case "mission_resolved": {
      await grantXp(ctx, userId, PASS.xp.missionResolved, "mission_resolved");
      // Daily first-mission bonus (once per UTC day, race-safe insert-or-skip).
      const flag = await ctx.db
        .insert(configKv)
        .values({ key: `pass_first_mission:${userId}:${day}`, value: true })
        .onConflictDoNothing({ target: configKv.key })
        .returning({ key: configKv.key });
      if (flag[0]) {
        await grantXp(ctx, userId, PASS.xp.dailyFirstMission, "daily_first_mission");
      }
      const locationSlug = typeof event.locationSlug === "string" ? event.locationSlug : null;
      const outcome = event.outcome as MissionOutcome;
      await bumpChallenges(ctx, userId, "missions_at_location", locationSlug, 1, now);
      if (WIN_OUTCOMES.has(outcome)) {
        await bumpChallenges(ctx, userId, "wins_anywhere", null, 1, now);
      }
      // "Survive X" = walked out with the stake or the score (not arrest/loss).
      if (SURVIVE_OUTCOMES.has(outcome)) {
        await bumpChallenges(ctx, userId, "survive_location", locationSlug, 1, now);
      }
      break;
    }
    case "bail_paid": {
      await grantXp(ctx, userId, PASS.xp.bailPaid, "bail_paid");
      await bumpChallenges(ctx, userId, "bail_outs", null, 1, now);
      break;
    }
    case "raffle_tickets_bought": {
      const count = typeof event.count === "number" ? event.count : 1;
      // 5 XP per ticket, capped at 25 XP per UTC day.
      const counterKey = `pass_xp_raffle:${userId}:${day}`;
      const already = Number(await getCounter(ctx.db, counterKey));
      const desired = count * PASS.xp.raffleTicket;
      const granted = Math.max(0, Math.min(desired, PASS.xp.raffleTicketDailyCap - already));
      if (granted > 0) {
        await addToCounter(ctx.db, counterKey, BigInt(granted));
        await grantXp(ctx, userId, granted, "raffle_tickets");
      }
      await bumpChallenges(ctx, userId, "raffle_tickets", null, count, now);
      break;
    }
    case "patrol_ended": {
      await grantXp(ctx, userId, PASS.xp.patrolCompleted, "patrol_completed");
      break;
    }
    default:
      break;
  }
}

/** Fan the bus's user events into pass XP. Called once per process at context build. */
export function registerPassListeners(ctx: AppContext): () => void {
  return ctx.bus.onAnyUser((userId, event) => {
    void handleEvent(ctx, userId, event).catch((err) => {
      ctx.log.error({ err, userId, eventType: event.type }, "pass xp handler failed");
    });
  });
}

/** Whether the user holds the premium pass for the season. */
export async function hasPremium(ctx: AppContext, userId: string): Promise<boolean> {
  const rows = await ctx.db
    .select({ premium: seasonPasses.premium })
    .from(seasonPasses)
    .where(and(eq(seasonPasses.userId, userId), eq(seasonPasses.season, PASS_SEASON)))
    .limit(1);
  return rows[0]?.premium === true;
}

/** Apply a claimed reward (kind whitelist — no SHINY, no stats, ever). */
export async function applyReward(
  ctx: AppContext,
  userId: string,
  reward: { kind: string; refSlug: string | null; amount: number | null },
): Promise<void> {
  switch (reward.kind) {
    case "cosmetic":
    case "nameplate": {
      if (reward.refSlug) {
        await ctx.db.insert(userCosmetics).values({ userId, itemSlug: reward.refSlug });
      }
      break;
    }
    case "insurance_voucher": {
      // specs/02 assumption: max 3 vouchers held.
      await ctx.db
        .update(users)
        .set({ insuranceVouchers: sql`least(${users.insuranceVouchers} + ${reward.amount ?? 1}, 3)` })
        .where(eq(users.id, userId));
      break;
    }
    case "raffle_fragments": {
      await addToCounter(ctx.db, `pass_fragments:${userId}`, BigInt(reward.amount ?? 0));
      break;
    }
    default:
      throw new Error(`pass: unknown reward kind ${reward.kind}`);
  }
}
