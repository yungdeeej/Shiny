/** Public transparency endpoints: stats, leaderboards, burn history, city feed. */
import type { FastifyInstance } from "fastify";
import { SEASON1, mintPrice } from "@trash-wars/economy";
import {
  JACKPOT,
  SUPPLY,
  leaderboardQuery,
  type JackpotState,
  type LeaderboardEntry,
  type PublicStats,
} from "@trash-wars/shared";
import {
  accounts,
  characters,
  jackpotEvents,
  ledgerEntries,
  ledgerTxns,
  missionOutcomes,
  missions,
  pdDistributions,
  seasonPasses,
  users,
} from "@trash-wars/db";
import { and, desc, eq, gt, gte, inArray, lt, sql } from "../core/orm.js";
import { sumBalanceByKinds } from "../core/accounts.js";
import { getKv } from "../core/config.js";
import { recentFeed } from "../core/feed.js";
import { utcDayKey } from "../core/time.js";

export default async function publicModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get("/public/feed", async () => recentFeed(ctx, 30));

  // v1.1 (specs/03): the public vault counter — unauthenticated, cached 10s.
  let jackpotCache: { state: JackpotState; expiresAt: number } | null = null;
  app.get("/public/jackpot", async () => {
    const now = Date.now();
    if (jackpotCache && jackpotCache.expiresAt > now) return jackpotCache.state;

    const [pool, winnableAtIso, winRows, seedRows] = await Promise.all([
      ctx.ledger.getBalance(ctx.accounts.jackpot_pool),
      getKv<string>(ctx.db, "jackpot_winnable_at"),
      ctx.db
        .select()
        .from(jackpotEvents)
        .where(eq(jackpotEvents.kind, "win"))
        .orderBy(desc(jackpotEvents.createdAt)),
      ctx.db
        .select({ v: sql<string>`coalesce(sum(${jackpotEvents.amount}), 0)::text` })
        .from(jackpotEvents)
        .where(eq(jackpotEvents.kind, "seed")),
    ]);
    const winnableAt = winnableAtIso ?? new Date(now).toISOString();
    const lastWin = winRows[0];
    let lastWinner: JackpotState["lastWinner"] = null;
    if (lastWin?.userId) {
      const u = await ctx.db
        .select({ handle: users.handle, anonymous: users.feedAnonymous })
        .from(users)
        .where(eq(users.id, lastWin.userId))
        .limit(1);
      lastWinner = {
        handle: u[0]?.anonymous ? "a masked stranger" : (u[0]?.handle ?? "unknown"),
        amount: lastWin.amount.toString(),
        at: lastWin.createdAt.toISOString(),
      };
    }
    const seeded = BigInt(seedRows[0]?.v ?? "0");
    const state: JackpotState = {
      pool: pool.toString(),
      winnable: now >= Date.parse(winnableAt),
      winnableAt,
      seeded: (seeded > 0n ? seeded : JACKPOT.seedAmount).toString(),
      hits: winRows.length,
      lastWinner,
    };
    jackpotCache = { state, expiresAt: now + 10_000 };
    return state;
  });

  app.get("/public/stats", async () => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const dayStart = new Date(`${utcDayKey(now)}T00:00:00.000Z`);

    const [burnedTotal, treasuryRake] = await Promise.all([
      sumBalanceByKinds(ctx.db, ["burn_pool", "burned"]),
      ctx.ledger.getBalance(ctx.accounts.treasury),
    ]);

    const burnedWeekRows = await ctx.db
      .select({ v: sql<string>`coalesce(sum(${ledgerEntries.delta}), 0)::text` })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(
        and(
          inArray(accounts.kind, ["burn_pool", "burned"]),
          gt(ledgerEntries.delta, 0n),
          gte(ledgerEntries.createdAt, weekAgo),
        ),
      );

    const emissionsSpentRows = await ctx.db
      .select({ v: sql<string>`coalesce(sum(-${ledgerEntries.delta}), 0)::text` })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(and(eq(accounts.kind, "emissions_budget"), lt(ledgerEntries.delta, 0n)));

    const seasonStartIso = await getKv<string>(ctx.db, "season_start");
    const seasonDay = seasonStartIso
      ? Math.max(1, Math.floor((now.getTime() - Date.parse(seasonStartIso)) / 86_400_000) + 1)
      : 1;

    const [playerRows, missionTodayRows, heistRows, houndRows, distRows, jackpotPool, tierRows, premiumRows] = await Promise.all([
      ctx.db.select({ n: sql<string>`count(*)::text` }).from(users),
      ctx.db
        .select({ n: sql<string>`count(*)::text` })
        .from(missions)
        .where(gte(missions.startedAt, dayStart)),
      ctx.db
        .select({ v: sql<string>`coalesce(max(${missionOutcomes.payout}), 0)::text` })
        .from(missionOutcomes)
        .where(gte(missionOutcomes.createdAt, weekAgo)),
      ctx.db
        .select({ n: sql<string>`count(*)::text` })
        .from(characters)
        .where(and(eq(characters.faction, "bloodhound"), sql`${characters.status} <> 'dead'`)),
      ctx.db
        .select({ v: sql<string>`coalesce(sum(${pdDistributions.distributed}), 0)::text` })
        .from(pdDistributions)
        .where(gte(pdDistributions.createdAt, weekAgo)),
      ctx.ledger.getBalance(ctx.accounts.jackpot_pool),
      ctx.db
        .select({ tier: users.currentTier, n: sql<string>`count(*)::text` })
        .from(users)
        .groupBy(users.currentTier),
      ctx.db
        .select({ n: sql<string>`count(*)::text` })
        .from(seasonPasses)
        .where(eq(seasonPasses.premium, true)),
    ]);

    const houndCount = Math.max(1, Number(houndRows[0]?.n ?? "0"));
    const weekly = BigInt(distRows[0]?.v ?? "0");
    const pdApr =
      Number((weekly * 52n * 10_000n) / (BigInt(houndCount) * mintPrice("bloodhound"))) / 100;

    const stats: PublicStats = {
      circulating: (SUPPLY.total - burnedTotal).toString(),
      burnedTotal: burnedTotal.toString(),
      burnedThisWeek: BigInt(burnedWeekRows[0]?.v ?? "0").toString(),
      emissionsSpent: BigInt(emissionsSpentRows[0]?.v ?? "0").toString(),
      emissionsBudget: SEASON1.emissions.toString(),
      seasonDay,
      seasonLengthDays: SEASON1.days,
      pdApr,
      players: Number(playerRows[0]?.n ?? "0"),
      missionsToday: Number(missionTodayRows[0]?.n ?? "0"),
      biggestHeistThisWeek: BigInt(heistRows[0]?.v ?? "0").toString(),
      treasuryRake: treasuryRake.toString(),
      // v1.1 telemetry (doc 14 §7).
      jackpotPool: jackpotPool.toString(),
      tierDistribution: Object.fromEntries(tierRows.map((r) => [r.tier, Number(r.n)])),
      passPremiumCount: Number(premiumRows[0]?.n ?? "0"),
    };
    return stats;
  });

  app.get("/public/burns", async () => {
    // Weekly burn-inflow aggregates by ref_type — the "we burned X, here's the
    // breakdown" trust signal (doc 09).
    const rows = await ctx.db
      .select({
        week: sql<string>`date_trunc('week', ${ledgerEntries.createdAt})::date::text`,
        refType: sql<string>`coalesce(${ledgerTxns.refType}, 'other')`,
        total: sql<string>`sum(${ledgerEntries.delta})::text`,
      })
      .from(ledgerEntries)
      .innerJoin(ledgerTxns, eq(ledgerTxns.id, ledgerEntries.txnId))
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(and(eq(accounts.kind, "burn_pool"), gt(ledgerEntries.delta, 0n)))
      .groupBy(
        sql`date_trunc('week', ${ledgerEntries.createdAt})`,
        sql`coalesce(${ledgerTxns.refType}, 'other')`,
      )
      .orderBy(sql`date_trunc('week', ${ledgerEntries.createdAt}) desc`);

    const weeks = new Map<string, { week: string; total: bigint; byRefType: Record<string, string> }>();
    for (const row of rows) {
      const entry = weeks.get(row.week) ?? { week: row.week, total: 0n, byRefType: {} };
      entry.total += BigInt(row.total);
      entry.byRefType[row.refType] = row.total;
      weeks.set(row.week, entry);
    }
    return [...weeks.values()].map((w) => ({ ...w, total: w.total.toString() }));
  });

  app.get("/leaderboard", async (request) => {
    const { board } = leaderboardQuery.parse(request.query ?? {});
    let entries: LeaderboardEntry[] = [];

    if (board === "earners") {
      const rows = await ctx.db
        .select({
          handle: users.handle,
          v: sql<string>`sum(${missionOutcomes.payout} - ${missions.stake})::text`,
        })
        .from(missionOutcomes)
        .innerJoin(missions, eq(missions.id, missionOutcomes.missionId))
        .innerJoin(users, eq(users.id, missions.userId))
        .groupBy(users.handle)
        .orderBy(sql`sum(${missionOutcomes.payout} - ${missions.stake}) desc`)
        .limit(20);
      entries = rows.map((r, i) => ({
        rank: i + 1,
        handle: r.handle,
        faction: "raccoon" as const,
        value: BigInt(r.v) < 0n ? "0" : r.v,
        detail: "net mission profit",
      }));
    } else if (board === "hounds") {
      const rows = await ctx.db
        .select({
          ownerId: accounts.ownerId,
          v: sql<string>`sum(${ledgerEntries.delta})::text`,
        })
        .from(ledgerEntries)
        .innerJoin(ledgerTxns, eq(ledgerTxns.id, ledgerEntries.txnId))
        .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
        .where(
          and(
            inArray(ledgerTxns.refType, ["mission_confiscation", "pd_distribution", "bribe"]),
            eq(accounts.ownerType, "user"),
            gt(ledgerEntries.delta, 0n),
          ),
        )
        .groupBy(accounts.ownerId)
        .orderBy(sql`sum(${ledgerEntries.delta}) desc`)
        .limit(20);
      const out: LeaderboardEntry[] = [];
      for (const [i, row] of rows.entries()) {
        if (!row.ownerId) continue;
        const u = await ctx.db
          .select({ handle: users.handle })
          .from(users)
          .where(eq(users.id, row.ownerId))
          .limit(1);
        out.push({
          rank: i + 1,
          handle: u[0]?.handle ?? "unknown",
          faction: "bloodhound",
          value: row.v,
          detail: "PD earnings",
        });
      }
      entries = out;
    } else if (board === "heists") {
      const rows = await ctx.db
        .select({
          handle: users.handle,
          v: sql<string>`max(${missionOutcomes.payout})::text`,
        })
        .from(missionOutcomes)
        .innerJoin(missions, eq(missions.id, missionOutcomes.missionId))
        .innerJoin(users, eq(users.id, missions.userId))
        .where(inArray(missionOutcomes.outcome, ["win", "jackpot"]))
        .groupBy(users.handle)
        .orderBy(sql`max(${missionOutcomes.payout}) desc`)
        .limit(20);
      entries = rows.map((r, i) => ({
        rank: i + 1,
        handle: r.handle,
        faction: "raccoon" as const,
        value: r.v,
        detail: "biggest single payout",
      }));
    } else {
      const rows = await ctx.db
        .select({
          handle: users.handle,
          v: sql<string>`sum(${missions.stake})::text`,
        })
        .from(missionOutcomes)
        .innerJoin(missions, eq(missions.id, missionOutcomes.missionId))
        .innerJoin(users, eq(users.id, missions.userId))
        .where(inArray(missionOutcomes.outcome, ["confiscation", "rekt_items", "rekt_character"]))
        .groupBy(users.handle)
        .orderBy(sql`sum(${missions.stake}) desc`)
        .limit(20);
      entries = rows.map((r, i) => ({
        rank: i + 1,
        handle: r.handle,
        faction: "raccoon" as const,
        value: r.v,
        detail: "tokens seized by the PD",
      }));
    }

    return { board, entries };
  });
}
