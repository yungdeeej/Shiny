/**
 * Season Pass module (v1.1, specs/02): GET /pass state, premium purchase
 * (beta rail; SOL confirm flow lands with the devnet provider), idempotent
 * reward claims with retroactive premium unlock.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PASS, passClaimRequest, type PassState } from "@trash-wars/shared";
import {
  passChallengeProgress,
  passChallenges,
  passClaims,
  passProgress,
  passRewards,
  seasonPasses,
  users,
} from "@trash-wars/db";
import { and, eq, inArray } from "../core/orm.js";
import { conflict, forbidden, notFound, notImplemented } from "../core/errors.js";
import {
  PASS_SEASON,
  applyReward,
  currentSeasonWeek,
  hasPremium,
  levelForXp,
} from "../core/pass.js";
import { requireAuth, requireTos } from "./session.js";

export default async function passModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get("/pass", async (request) => {
    const user = requireAuth(request);

    const [progressRows, premium, userRows, rewards, week] = await Promise.all([
      ctx.db
        .select()
        .from(passProgress)
        .where(and(eq(passProgress.userId, user.id), eq(passProgress.season, PASS_SEASON)))
        .limit(1),
      hasPremium(ctx, user.id),
      ctx.db.select({ vouchers: users.insuranceVouchers }).from(users).where(eq(users.id, user.id)).limit(1),
      ctx.db.select().from(passRewards).where(eq(passRewards.season, PASS_SEASON)),
      currentSeasonWeek(ctx),
    ]);
    const xp = progressRows[0]?.xp ?? 0;
    const level = levelForXp(xp);

    const claims = await ctx.db
      .select({ rewardId: passClaims.rewardId })
      .from(passClaims)
      .where(eq(passClaims.userId, user.id));
    const claimed = new Set(claims.map((c) => c.rewardId));

    const challenges = await ctx.db
      .select()
      .from(passChallenges)
      .where(and(eq(passChallenges.season, PASS_SEASON), eq(passChallenges.week, week)));
    const progressByChallenge = new Map<string, { progress: number; completed: boolean }>();
    if (challenges.length > 0) {
      const rows = await ctx.db
        .select()
        .from(passChallengeProgress)
        .where(
          and(
            eq(passChallengeProgress.userId, user.id),
            inArray(
              passChallengeProgress.challengeId,
              challenges.map((c) => c.id),
            ),
          ),
        );
      for (const row of rows) {
        progressByChallenge.set(row.challengeId, {
          progress: row.progress,
          completed: row.completedAt !== null,
        });
      }
    }

    const state: PassState = {
      season: PASS_SEASON,
      premium,
      level,
      xp,
      xpIntoLevel: level >= PASS.levels ? 0 : xp - level * PASS.xpPerLevel,
      xpPerLevel: PASS.xpPerLevel,
      insuranceVouchers: userRows[0]?.vouchers ?? 0,
      rewards: rewards
        .sort((a, b) => a.level - b.level || (a.track === "free" ? -1 : 1))
        .map((r) => ({
          id: r.id,
          level: r.level,
          track: r.track,
          kind: r.kind,
          refSlug: r.refSlug,
          amount: r.amount,
          claimed: claimed.has(r.id),
          claimable:
            !claimed.has(r.id) && level >= r.level && (r.track === "free" || premium),
        })),
      challenges: challenges.map((c) => ({
        id: c.id,
        slug: c.slug,
        description: c.description,
        week: c.week,
        target: c.target,
        progress: progressByChallenge.get(c.id)?.progress ?? 0,
        xp: c.xp,
        completed: progressByChallenge.get(c.id)?.completed ?? false,
      })),
    };
    return state;
  });

  app.post("/pass/buy", async (request) => {
    const user = requireTos(request);
    if (!ctx.env.beta) {
      // Devnet/mainnet: doc 11's SOL-confirm flow (unsigned transfer → confirm
      // by tx signature) lands with the real chain provider.
      throw notImplemented("premium pass is SOL-rail only outside beta — not wired yet");
    }
    // Beta rail: premium granted free with a BETA-labeled receipt. Idempotent —
    // the (user_id, season) unique constraint arbiters; a second buy is a no-op.
    const receipt = `BETA-PASS-${randomUUID()}`;
    const inserted = await ctx.db
      .insert(seasonPasses)
      .values({ userId: user.id, season: PASS_SEASON, premium: true, txSig: receipt })
      .onConflictDoNothing({ target: [seasonPasses.userId, seasonPasses.season] })
      .returning();
    if (inserted[0]) {
      return { ok: true, premium: true, receipt, alreadyOwned: false };
    }
    const existing = await ctx.db
      .select()
      .from(seasonPasses)
      .where(and(eq(seasonPasses.userId, user.id), eq(seasonPasses.season, PASS_SEASON)))
      .limit(1);
    return { ok: true, premium: true, receipt: existing[0]?.txSig ?? null, alreadyOwned: true };
  });

  app.post("/pass/claim", async (request) => {
    const user = requireTos(request);
    const { rewardId } = passClaimRequest.parse(request.body);

    const rewardRows = await ctx.db
      .select()
      .from(passRewards)
      .where(eq(passRewards.id, rewardId))
      .limit(1);
    const reward = rewardRows[0];
    if (!reward || reward.season !== PASS_SEASON) throw notFound("reward not found");

    if (reward.track === "premium" && !(await hasPremium(ctx, user.id))) {
      throw forbidden("premium track requires the Season Pass");
    }
    const progressRows = await ctx.db
      .select()
      .from(passProgress)
      .where(and(eq(passProgress.userId, user.id), eq(passProgress.season, PASS_SEASON)))
      .limit(1);
    const level = levelForXp(progressRows[0]?.xp ?? 0);
    if (level < reward.level) {
      throw conflict("LEVEL_TOO_LOW", `reach level ${reward.level} to claim this`);
    }

    // Exactly-once: the (user_id, reward_id) unique constraint is the arbiter.
    const claimedNow = await ctx.db
      .insert(passClaims)
      .values({ userId: user.id, rewardId })
      .onConflictDoNothing({ target: [passClaims.userId, passClaims.rewardId] })
      .returning({ id: passClaims.id });
    if (!claimedNow[0]) {
      return { ok: true, alreadyClaimed: true };
    }
    await applyReward(ctx, user.id, reward);
    return { ok: true, alreadyClaimed: false };
  });
}
