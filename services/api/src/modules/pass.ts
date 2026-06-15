/**
 * Season Pass module (v1.1, specs/02): GET /pass state, premium purchase
 * (beta rail; SOL confirm flow lands with the devnet provider), idempotent
 * reward claims with retroactive premium unlock.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  PASS,
  passClaimRequest,
  solConfirmRequest,
  type PassState,
  type SolBuyResponse,
  type SolConfirmResponse,
} from "@trash-wars/shared";
import {
  passChallengeProgress,
  passChallenges,
  passClaims,
  passProgress,
  passRewards,
  seasonPasses,
  solPayments,
  users,
  wallets,
} from "@trash-wars/db";
import { and, eq, inArray } from "../core/orm.js";
import { badRequest, conflict, forbidden, notFound, notImplemented } from "../core/errors.js";
import {
  buildSolPayment,
  getSolRail,
  priceLamports,
  readMemoRef,
  verifySolPayment,
} from "../core/sol-payments.js";
import {
  PASS_SEASON,
  applyReward,
  currentSeasonWeek,
  hasPremium,
  levelForXp,
} from "../core/pass.js";
import { requireAuth, requireTos } from "./session.js";

/** The user's primary wallet address — the payer the SOL rail binds against. */
async function primaryWallet(
  ctx: FastifyInstance["ctx"],
  userId: string,
): Promise<string | null> {
  const rows = await ctx.db.select().from(wallets).where(eq(wallets.userId, userId));
  const primary = rows.find((w) => w.isPrimary) ?? rows[0];
  return primary?.address ?? null;
}

/** Grant the season pass premium flag idempotently (no-op if already premium). */
async function grantPremium(ctx: FastifyInstance["ctx"], userId: string, txSig: string): Promise<void> {
  await ctx.db
    .insert(seasonPasses)
    .values({ userId, season: PASS_SEASON, premium: true, txSig })
    .onConflictDoUpdate({
      target: [seasonPasses.userId, seasonPasses.season],
      set: { premium: true },
    });
}

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
    const rail = getSolRail();
    if (rail.config.enabled && rail.config.revenueWallet) {
      // SOL rail configured: doc 11's unsigned-transfer → confirm flow. Returns an
      // intent the wallet signs+sends; /pass/confirm verifies + grants premium.
      const payer = await primaryWallet(ctx, user.id);
      if (!payer) throw badRequest("NO_WALLET", "link a primary wallet before SOL purchases");
      const price = await priceLamports(ctx.db, "season_pass", "premium");
      const built = await buildSolPayment({
        payer,
        product: "season_pass",
        ref: price.ref,
        lamports: price.lamports,
        revenueWallet: rail.config.revenueWallet,
        rpc: rail.rpc,
      });
      const response: SolBuyResponse = {
        product: "season_pass",
        ref: price.ref,
        priceSol: price.priceSol,
        lamports: price.lamports,
        revenueWallet: rail.config.revenueWallet,
        reference: built.reference,
        memo: built.memo,
        serializedTx: built.serializedTx,
        expiresAt: built.expiresAt,
      };
      return response;
    }
    if (!ctx.env.beta) {
      // No SOL rail and not beta: premium is SOL-rail only — configure REVENUE_WALLET.
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

  app.post("/pass/confirm", async (request) => {
    const user = requireTos(request);
    const { txSig, reference } = solConfirmRequest.parse(request.body);
    const rail = getSolRail();
    if (!rail.config.enabled || !rail.config.revenueWallet) {
      throw notImplemented("SOL rail not configured in beta");
    }

    // Fast idempotent replay on a known signature.
    const seen = await ctx.db
      .select()
      .from(solPayments)
      .where(eq(solPayments.txSig, txSig))
      .limit(1);
    if (seen[0]) {
      const response: SolConfirmResponse = {
        granted: true,
        product: "season_pass",
        ref: seen[0].ref,
        txSig,
        alreadyGranted: true,
      };
      return response;
    }

    const payer = await primaryWallet(ctx, user.id);
    if (!payer) throw badRequest("NO_WALLET", "link a primary wallet before SOL purchases");

    const memoRef = await readMemoRef(rail.rpc, txSig);
    if (!memoRef || memoRef.product !== "season_pass") {
      throw badRequest("PAYMENT_UNVERIFIED", "not a season-pass SOL payment");
    }
    if (memoRef.reference !== reference) {
      throw badRequest("PAYMENT_UNVERIFIED", "reference mismatch");
    }
    const price = await priceLamports(ctx.db, "season_pass", "premium");

    const result = await verifySolPayment({
      txSig,
      reference,
      expectedPayer: payer,
      expectedLamports: price.lamports,
      revenueWallet: rail.config.revenueWallet,
      rpc: rail.rpc,
    });
    if (!result.ok) {
      throw badRequest("PAYMENT_UNVERIFIED", `SOL payment not verified: ${result.reason}`);
    }

    // Record the receipt idempotently — the unique tx_sig is the grant arbiter.
    const recorded = await ctx.db
      .insert(solPayments)
      .values({
        txSig,
        userId: user.id,
        product: "season_pass",
        ref: price.ref,
        reference,
        lamports: BigInt(price.lamports),
      })
      .onConflictDoNothing({ target: solPayments.txSig })
      .returning();
    if (!recorded[0]) {
      const response: SolConfirmResponse = {
        granted: true,
        product: "season_pass",
        ref: price.ref,
        txSig,
        alreadyGranted: true,
      };
      return response;
    }

    await grantPremium(ctx, user.id, txSig);
    const response: SolConfirmResponse = {
      granted: true,
      product: "season_pass",
      ref: price.ref,
      txSig,
      alreadyGranted: false,
    };
    return response;
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
