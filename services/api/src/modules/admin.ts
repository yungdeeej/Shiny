/** Admin: user ops, kill switches, withdrawal review, one-way-ratchet economy tuning. */
import type { FastifyInstance } from "fastify";
import {
  SEASON1,
  checkSeasonInvariant,
  computeEvBps,
} from "@trash-wars/economy";
import {
  adminFreezeRequest,
  adminPauseRequest,
  adminTuneRequest,
  locationConfig,
  toBaseUnits,
  type LocationConfig,
} from "@trash-wars/shared";
import {
  auditLog,
  locations,
  pendingChanges,
  sybilFlags,
  users,
  withdrawals,
} from "@trash-wars/db";
import { and, desc, eq } from "../core/orm.js";
import { badRequest, notFound } from "../core/errors.js";
import { setKv, getKv } from "../core/config.js";
import { getUserAccount, unlockedBalance } from "../core/accounts.js";
import { listLocations, parseLocation } from "../core/locations.js";
import { requireAdmin } from "./session.js";

const RATCHET_DELAY_MS = 48 * 3600 * 1000; // public-timelocked increases (doc 09)

export default async function adminModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  async function audit(actor: string, action: string, detail: Record<string, unknown>) {
    await ctx.db.insert(auditLog).values({ actor, action, detail });
  }

  app.get<{ Params: { id: string } }>("/admin/users/:id", async (request) => {
    requireAdmin(request);
    const rows = await ctx.db.select().from(users).where(eq(users.id, request.params.id)).limit(1);
    const user = rows[0];
    if (!user) throw notFound("user not found");
    const [balances, flags] = await Promise.all([
      unlockedBalance(ctx.db, ctx.ledger, user.id),
      ctx.db.select().from(sybilFlags).where(eq(sybilFlags.userId, user.id)),
    ]);
    return {
      id: user.id,
      handle: user.handle,
      role: user.role,
      isGuest: user.isGuest,
      frozen: user.frozen,
      tosVersion: user.tosVersion,
      balance: balances.balance.toString(),
      lockedBalance: balances.locked.toString(),
      flags: flags.map((f) => ({ clusterKey: f.clusterKey, severity: f.severity })),
      createdAt: user.createdAt.toISOString(),
    };
  });

  app.post("/admin/pause", async (request) => {
    const admin = requireAdmin(request);
    const { key, paused } = adminPauseRequest.parse(request.body);
    await setKv(ctx.db, `${key}_paused`, paused);
    await audit(admin.handle, "pause", { key, paused });
    return { ok: true, key, paused };
  });

  app.post("/admin/freeze-user", async (request) => {
    const admin = requireAdmin(request);
    const { userId, frozen } = adminFreezeRequest.parse(request.body);
    const updated = await ctx.db
      .update(users)
      .set({ frozen, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!updated[0]) throw notFound("user not found");
    await audit(admin.handle, "freeze_user", { userId, frozen });
    return { ok: true, userId, frozen };
  });

  app.get("/admin/withdrawals/review", async (request) => {
    requireAdmin(request);
    const rows = await ctx.db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.state, "review"))
      .orderBy(desc(withdrawals.createdAt));
    return rows.map((w) => ({
      id: w.id,
      userId: w.userId,
      amount: w.amount.toString(),
      fee: w.fee.toString(),
      destAddress: w.destAddress,
      reason: w.reason,
      createdAt: w.createdAt.toISOString(),
    }));
  });

  app.post<{ Params: { id: string } }>("/admin/withdrawals/:id/approve", async (request) => {
    const admin = requireAdmin(request);
    const updated = await ctx.db
      .update(withdrawals)
      .set({ state: "queued", reason: null })
      .where(and(eq(withdrawals.id, request.params.id), eq(withdrawals.state, "review")))
      .returning();
    if (!updated[0]) throw notFound("withdrawal not in review");
    await audit(admin.handle, "withdrawal_approve", { id: request.params.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/admin/withdrawals/:id/deny", async (request) => {
    const admin = requireAdmin(request);
    const updated = await ctx.db
      .update(withdrawals)
      .set({ state: "denied", processedAt: new Date() })
      .where(and(eq(withdrawals.id, request.params.id), eq(withdrawals.state, "review")))
      .returning();
    const wd = updated[0];
    if (!wd) throw notFound("withdrawal not in review");

    // Reverse with a NEW transaction (never mutate history): refund net + fee.
    const net = wd.amount - wd.fee;
    const account = await getUserAccount(ctx.ledger, wd.userId);
    await ctx.ledger.postTransaction(
      [
        { accountId: ctx.accounts.withdrawals_payable, delta: -net },
        { accountId: ctx.accounts.treasury, delta: -wd.fee },
        { accountId: account, delta: wd.amount },
      ],
      { idempotencyKey: `withdraw-deny:${wd.id}`, refType: "withdrawal_denied", refId: wd.id },
    );
    await audit(admin.handle, "withdrawal_deny", { id: wd.id, refunded: wd.amount.toString() });
    return { ok: true, refunded: wd.amount.toString() };
  });

  app.post("/admin/tune", async (request) => {
    const admin = requireAdmin(request);
    const { locationSlug, patch } = adminTuneRequest.parse(request.body);

    const rows = await ctx.db
      .select()
      .from(locations)
      .where(eq(locations.slug, locationSlug))
      .limit(1);
    if (!rows[0]) throw notFound("location not found");
    const current = parseLocation(rows[0]).config;

    const merged: LocationConfig = locationConfig.parse({
      ...current,
      ...patch,
      slug: locationSlug,
    });

    // Season invariant (doc 01/09): never approve a config the budget can't carry.
    const all = await listLocations(ctx);
    const projected = all.map((l) => (l.slug === locationSlug ? merged : l.config));
    const seasonStartIso = await getKv<string>(ctx.db, "season_start");
    const elapsedDays = seasonStartIso
      ? Math.floor((Date.now() - Date.parse(seasonStartIso)) / 86_400_000)
      : 0;
    // Projection assumptions: 500 DAU at 1k average stake (the season-1 default
    // tables sit at ~53% of the allowed daily EV under these inputs, leaving
    // tuning headroom while still rejecting runaway multiplier configs).
    const invariant = checkSeasonInvariant(projected, {
      dau: 500,
      avgStake: toBaseUnits(1_000),
      remainingBudget: SEASON1.emissions, // conservative: full budget assumption
      remainingDays: Math.max(1, SEASON1.days - elapsedDays),
    });
    if (!invariant.ok) {
      throw badRequest("INVARIANT_VIOLATION", invariant.reason);
    }

    // One-way ratchet: generosity DECREASES apply now; INCREASES wait 48h publicly.
    const isIncrease =
      computeEvBps(merged.table) > computeEvBps(current.table) ||
      BigInt(merged.idleRatePerHour) > BigInt(current.idleRatePerHour) ||
      BigInt(merged.maxStake) > BigInt(current.maxStake);

    if (isIncrease) {
      const effectiveAt = new Date(Date.now() + RATCHET_DELAY_MS);
      await ctx.db.insert(pendingChanges).values({
        key: `location:${locationSlug}`,
        value: merged,
        effectiveAt,
      });
      await audit(admin.handle, "tune_pending", { locationSlug, patch, effectiveAt });
      return { ok: true, applied: false, effectiveAt: effectiveAt.toISOString() };
    }

    await ctx.db
      .update(locations)
      .set({ config: merged, enabled: merged.enabled })
      .where(eq(locations.slug, locationSlug));
    await audit(admin.handle, "tune_applied", { locationSlug, patch });
    return { ok: true, applied: true };
  });
}
