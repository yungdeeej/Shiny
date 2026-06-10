/** PvP module: bloodhound patrols, heat aggregates, PD pool stats. */
import type { FastifyInstance } from "fastify";
import { heatBandForWeight, mintPrice } from "@trash-wars/economy";
import { STAT_EFFECTS, patrolRequest, type Patrol, type PvpStats } from "@trash-wars/shared";
import {
  accounts,
  characters,
  ledgerEntries,
  ledgerTxns,
  patrols,
  pdDistributions,
} from "@trash-wars/db";
import { and, eq, gt, gte, inArray, ne, sql } from "../core/orm.js";
import { badRequest, conflict, notFound } from "../core/errors.js";
import { getLocation, patrolWeightAt } from "../core/locations.js";
import { publishFeed } from "../core/feed.js";
import { requireTos } from "./session.js";

export default async function pvpModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.post("/pvp/patrols", async (request) => {
    const user = requireTos(request);
    const body = patrolRequest.parse(request.body);

    const rows = await ctx.db
      .select()
      .from(characters)
      .where(eq(characters.id, body.characterId))
      .limit(1);
    const char = rows[0];
    if (!char || char.ownerUserId !== user.id) throw notFound("character not found");
    if (char.faction !== "bloodhound") throw badRequest("WRONG_FACTION", "only bloodhounds patrol");
    if (!char.inGame) throw badRequest("NOT_IN_GAME", "character is not staked in-game");
    if (char.status !== "idle") throw conflict("CHARACTER_BUSY", `character is ${char.status}`);

    const location = await getLocation(ctx, body.locationSlug);
    const weight = 1 + char.stats.reputation * STAT_EFFECTS.reputationWeightPerLevel;

    const now = new Date();
    const shiftEnd = new Date(now.getTime() + ctx.clock.gameHoursToMs(6));
    const inserted = await ctx.db
      .insert(patrols)
      .values({
        characterId: char.id,
        locationSlug: location.slug,
        weight,
        shiftStart: now,
        shiftEnd,
        active: true,
      })
      .returning();
    const patrol = inserted[0]!;

    // Aggregate cap check AFTER insert (insert-then-verify keeps races safe:
    // both racers see the overflow and exactly the later one rolls back).
    const total = await patrolWeightAt(ctx, location.slug, now);
    if (total > location.config.patrolWeightCap + 1e-9) {
      await ctx.db.delete(patrols).where(eq(patrols.id, patrol.id));
      throw conflict("PATROL_FULL", `patrol weight cap reached at ${location.name}`);
    }

    await ctx.db
      .update(characters)
      .set({ status: "on_patrol" })
      .where(eq(characters.id, char.id));

    await publishFeed(ctx, {
      type: "patrol",
      locationSlug: location.slug,
      message: `🚓 PD presence thickens around ${location.name} — heat is ${heatBandForWeight(total)}`,
    });

    const api: Patrol = {
      id: patrol.id,
      characterId: char.id,
      characterName: char.name,
      locationSlug: location.slug,
      weight,
      shiftEndsAt: shiftEnd.toISOString(),
    };
    return api;
  });

  app.get("/pvp/patrols", async (request) => {
    const user = request.user;
    const now = new Date();
    const active = await ctx.db
      .select({ patrol: patrols, character: characters })
      .from(patrols)
      .innerJoin(characters, eq(characters.id, patrols.characterId))
      .where(and(eq(patrols.active, true), gt(patrols.shiftEnd, now)));

    const byLocation = new Map<string, number>();
    for (const row of active) {
      byLocation.set(
        row.patrol.locationSlug,
        (byLocation.get(row.patrol.locationSlug) ?? 0) + row.patrol.weight,
      );
    }

    return {
      mine: user
        ? active
            .filter((r) => r.character.ownerUserId === user.id)
            .map((r) => ({
              id: r.patrol.id,
              characterId: r.character.id,
              characterName: r.character.name,
              locationSlug: r.patrol.locationSlug,
              weight: r.patrol.weight,
              shiftEndsAt: r.patrol.shiftEnd.toISOString(),
            }))
        : [],
      locations: [...byLocation.entries()].map(([slug, weight]) => ({
        locationSlug: slug,
        weight,
        heat: heatBandForWeight(weight),
      })),
    };
  });

  app.get("/pvp/stats", async () => {
    const pdPool = await ctx.ledger.getBalance(ctx.accounts.pd_pool);

    const counts = await ctx.db
      .select({
        living: sql<string>`count(*)::text`,
        hounds: sql<string>`count(*) filter (where ${characters.faction} = 'bloodhound')::text`,
      })
      .from(characters)
      .where(ne(characters.status, "dead"));
    const livingCharacters = Number(counts[0]?.living ?? "0");
    const bloodhoundCount = Number(counts[0]?.hounds ?? "0");

    // Trailing APR ≈ (last 7 real days of PD payouts) * 52 / (hound capital at mint price).
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const distRows = await ctx.db
      .select({ v: sql<string>`coalesce(sum(${pdDistributions.distributed}), 0)::text` })
      .from(pdDistributions)
      .where(gte(pdDistributions.createdAt, weekAgo));
    const weekly = BigInt(distRows[0]?.v ?? "0");
    const capital = BigInt(Math.max(1, bloodhoundCount)) * mintPrice("bloodhound");
    const trailingApr = Number((weekly * 52n * 10_000n) / capital) / 100; // percent

    // Top hounds: owner earnings attributed to their highest-reputation living hound.
    // Positive user-account legs on mission_loss txns are exactly the patrol bounties
    // (settlement posts one atomic txn, so bounties share the mission's refType).
    const earnRows = await ctx.db
      .select({
        ownerId: accounts.ownerId,
        v: sql<string>`coalesce(sum(${ledgerEntries.delta}), 0)::text`,
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
      .limit(10);

    const topHounds: PvpStats["topHounds"] = [];
    for (const row of earnRows) {
      if (!row.ownerId) continue;
      const hounds = await ctx.db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.ownerUserId, row.ownerId),
            eq(characters.faction, "bloodhound"),
            ne(characters.status, "dead"),
          ),
        );
      const best = hounds.sort((a, b) => b.stats.reputation - a.stats.reputation)[0];
      if (!best) continue;
      topHounds.push({ name: best.name, reputation: best.stats.reputation, earned: row.v });
    }

    const stats: PvpStats = {
      pdPool: pdPool.toString(),
      trailingApr,
      bloodhoundCount,
      livingCharacters,
      topHounds,
    };
    return stats;
  });
}
