/** Game module: live locations, mission lifecycle (start / read / verify / insurance / bribe). */
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  applyBribe,
  applyPatrolModifiers,
  applyStatModifiers,
  commitHash,
  generateServerSeed,
  heatBandForWeight,
  insurancePrice,
  PROVABLY_FAIR_ALGORITHM,
} from "@trash-wars/economy";
import {
  POLICY,
  ZERO_STATS,
  applyBps,
  missionStartRequest,
  type LocationLive,
  type Mission,
  type MissionVerify,
  type CharacterStats,
} from "@trash-wars/shared";
import { characters, missionOutcomes, missions, wallets } from "@trash-wars/db";
import { and, desc, eq, inArray, sql } from "../core/orm.js";
import {
  badRequest,
  conflict,
  insufficientFunds,
  notFound,
} from "../core/errors.js";
import { getCounter, getFlag, getKv } from "../core/config.js";
import { getUserAccount, unlockedBalance } from "../core/accounts.js";
import { encryptSecret } from "../core/crypto.js";
import {
  activePatrolsAt,
  getLocation,
  listLocations,
  patrolWeightAt,
  type LocationRow,
} from "../core/locations.js";
import { settleMission } from "../core/settle.js";
import { publishFeed } from "../core/feed.js";
import { complianceGate, requireNotFrozen, requireTos } from "./session.js";

type MissionRow = typeof missions.$inferSelect;

export function missionToApi(m: MissionRow): Mission {
  return {
    id: m.id,
    locationSlug: m.locationSlug,
    characterId: m.characterId,
    stake: m.stake.toString(),
    state: m.state,
    serverSeedHash: m.serverSeedHash,
    clientSeed: m.clientSeed,
    effectiveTable: m.effectiveTable,
    insurance: m.insurance,
    bribed: m.bribed,
    startedAt: m.startedAt.toISOString(),
    resolvesAt: m.resolvesAt.toISOString(),
  };
}

export default async function gameModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get("/game/locations", async () => {
    const locs = await listLocations(ctx);
    const now = new Date();
    const counts = await ctx.db
      .select({ slug: missions.locationSlug, n: sql<string>`count(*)::text` })
      .from(missions)
      .where(eq(missions.state, "active"))
      .groupBy(missions.locationSlug);
    const activeBySlug = new Map(counts.map((c) => [c.slug, Number(c.n)]));

    const result: LocationLive[] = [];
    for (const loc of locs) {
      if (!loc.enabled) continue;
      const weight = await patrolWeightAt(ctx, loc.slug, now);
      result.push({
        ...loc.config,
        enabled: loc.enabled,
        heat: heatBandForWeight(weight),
        playersActive: activeBySlug.get(loc.slug) ?? 0,
        effectiveTable: applyPatrolModifiers(loc.config.table, weight, loc.config),
      });
    }
    return result;
  });

  app.post("/game/missions", async (request) => {
    const user = requireNotFrozen(requireTos(request));
    await complianceGate(ctx, request, "play");
    if (await getFlag(ctx.db, "missions_paused")) {
      throw conflict("MISSIONS_PAUSED", "missions are paused");
    }
    const body = missionStartRequest.parse(request.body);
    const stake = BigInt(body.stake);
    const location = await getLocation(ctx, body.locationSlug);
    if (!location.enabled) throw badRequest("LOCATION_DISABLED", "location is disabled");
    const cfg = location.config;
    if (stake < BigInt(cfg.minStake) || stake > BigInt(cfg.maxStake)) {
      throw badRequest("STAKE_OUT_OF_RANGE", `stake must be in [${cfg.minStake}, ${cfg.maxStake}]`);
    }

    let stats: CharacterStats = ZERO_STATS;
    let characterId: string | null = null;
    let freeTier = false;

    if (body.characterId) {
      const rows = await ctx.db
        .select()
        .from(characters)
        .where(eq(characters.id, body.characterId))
        .limit(1);
      const char = rows[0];
      if (!char || char.ownerUserId !== user.id) throw notFound("character not found");
      if (char.faction !== "raccoon") {
        throw badRequest("WRONG_FACTION", "only raccoons run missions");
      }
      if (!char.inGame) throw badRequest("NOT_IN_GAME", "character is not staked in-game");
      if (char.status !== "idle") {
        throw conflict("CHARACTER_BUSY", `character is ${char.status}`);
      }
      stats = char.stats;
      characterId = char.id;
    } else {
      // Free-tier token mission (doc 06): holding-gated, cooldown, capped stake.
      if (!cfg.freeTierAllowed) {
        throw badRequest("CHARACTER_REQUIRED", "this location requires a character");
      }
      freeTier = true;
      const walletRows = await ctx.db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, user.id));
      const primary = walletRows.find((w) => w.isPrimary) ?? walletRows[0];
      if (!primary && !ctx.env.beta) {
        throw badRequest("NO_WALLET", "link a wallet to run free-tier missions");
      }
      const holding = await ctx.chain.getShinyHolding(primary?.address ?? "beta-guest");
      if (holding < ctx.env.freeTierMinHolding) {
        throw badRequest("HOLDING_TOO_LOW", "free tier requires holding 10k $SHINY");
      }
      const maxFreeStake =
        holding / 10n < POLICY.freeTierMaxStake ? holding / 10n : POLICY.freeTierMaxStake;
      if (stake > maxFreeStake) {
        throw badRequest("STAKE_TOO_HIGH", `free-tier stake cap is ${maxFreeStake}`);
      }
      const lastFree = await ctx.db
        .select({ startedAt: missions.startedAt })
        .from(missions)
        .where(and(eq(missions.userId, user.id), eq(missions.freeTier, true)))
        .orderBy(desc(missions.startedAt))
        .limit(1);
      const cooldownMs = ctx.clock.gameHoursToMs(POLICY.freeTierCooldownHours);
      if (lastFree[0] && Date.now() - lastFree[0].startedAt.getTime() < cooldownMs) {
        throw conflict("FREE_TIER_COOLDOWN", "free-tier mission cooldown active");
      }
    }

    const balances = await unlockedBalance(ctx.db, ctx.ledger, user.id);
    if (balances.unlocked < stake) throw insufficientFunds();

    // Odds-at-stake-time (doc 08): stats + live patrol pressure, persisted.
    const now = new Date();
    const weight = await patrolWeightAt(ctx, cfg.slug, now);
    const effectiveTable = applyPatrolModifiers(applyStatModifiers(cfg.table, stats), weight, cfg);

    // Commit-reveal: outcome is fixed here; only the hash leaves the server.
    const serverSeed = generateServerSeed();
    const missionId = randomUUID();
    const clientSeed = body.clientSeed ?? randomBytes(16).toString("hex");
    const resolvesAt = new Date(now.getTime() + ctx.clock.gameHoursToMs(cfg.durationHours));

    const inserted = await ctx.db
      .insert(missions)
      .values({
        id: missionId,
        characterId,
        userId: user.id,
        locationSlug: cfg.slug,
        stake,
        state: "active",
        serverSeedHash: commitHash(serverSeed),
        serverSeedEnc: encryptSecret(serverSeed, ctx.env.serverSeedEncryptionKey),
        clientSeed,
        effectiveTable,
        freeTier,
        startedAt: now,
        resolvesAt,
      })
      .returning();

    const account = await getUserAccount(ctx.ledger, user.id);
    await ctx.ledger.postTransaction(
      [
        { accountId: account, delta: -stake },
        { accountId: ctx.accounts.mission_escrow, delta: stake },
      ],
      { idempotencyKey: `mission-stake:${missionId}`, refType: "mission_stake", refId: missionId },
    );

    if (characterId) {
      await ctx.db
        .update(characters)
        .set({ status: "on_mission" })
        .where(eq(characters.id, characterId));
    }

    return missionToApi(inserted[0]!);
  });

  app.get("/game/missions", async (request) => {
    const user = requireTos(request);
    // Lazy settlement: any read of a due mission settles it.
    const due = await ctx.db
      .select({ id: missions.id })
      .from(missions)
      .where(
        and(
          eq(missions.userId, user.id),
          eq(missions.state, "active"),
          sql`${missions.resolvesAt} <= now()`,
        ),
      );
    for (const m of due) await settleMission(ctx, m.id);

    const [active, resolved] = await Promise.all([
      ctx.db
        .select()
        .from(missions)
        .where(and(eq(missions.userId, user.id), eq(missions.state, "active")))
        .orderBy(desc(missions.startedAt)),
      ctx.db
        .select({ mission: missions, outcome: missionOutcomes })
        .from(missions)
        .innerJoin(missionOutcomes, eq(missionOutcomes.missionId, missions.id))
        .where(and(eq(missions.userId, user.id), eq(missions.state, "resolved")))
        .orderBy(desc(missions.resolvesAt))
        .limit(20),
    ]);

    return {
      active: active.map(missionToApi),
      resolved: resolved.map((r) => ({
        ...missionToApi(r.mission),
        outcome: {
          missionId: r.mission.id,
          outcome: r.outcome.outcome,
          payout: r.outcome.payout.toString(),
          serverSeed: r.outcome.serverSeed,
          detail: r.outcome.detail ?? undefined,
        },
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/game/missions/:id", async (request) => {
    const user = requireTos(request);
    const rows = await ctx.db
      .select()
      .from(missions)
      .where(eq(missions.id, request.params.id))
      .limit(1);
    const mission = rows[0];
    if (!mission || mission.userId !== user.id) throw notFound("mission not found");

    const settled = await settleMission(ctx, mission.id); // settles iff due
    const fresh = settled
      ? (await ctx.db.select().from(missions).where(eq(missions.id, mission.id)).limit(1))[0]!
      : mission;

    const outcomeRows = await ctx.db
      .select()
      .from(missionOutcomes)
      .where(eq(missionOutcomes.missionId, mission.id))
      .limit(1);
    const o = outcomeRows[0];
    return {
      ...missionToApi(fresh),
      outcome: o
        ? {
            missionId: mission.id,
            outcome: o.outcome,
            payout: o.payout.toString(),
            serverSeed: o.serverSeed,
            detail: o.detail ?? undefined,
          }
        : null,
    };
  });

  // Public verifier — anyone can recompute the outcome from revealed seeds.
  app.get<{ Params: { id: string } }>("/game/missions/:id/verify", async (request) => {
    const rows = await ctx.db
      .select()
      .from(missions)
      .where(eq(missions.id, request.params.id))
      .limit(1);
    const mission = rows[0];
    if (!mission) throw notFound("mission not found");
    await settleMission(ctx, mission.id);
    const outcomeRows = await ctx.db
      .select()
      .from(missionOutcomes)
      .where(eq(missionOutcomes.missionId, mission.id))
      .limit(1);
    const o = outcomeRows[0];
    if (!o) throw notFound("mission not resolved yet — seeds stay sealed until resolution");

    const verify: MissionVerify = {
      missionId: mission.id,
      serverSeedHash: mission.serverSeedHash,
      serverSeed: o.serverSeed,
      clientSeed: mission.clientSeed,
      algorithm: PROVABLY_FAIR_ALGORITHM,
      table: mission.effectiveTable,
      roll: o.roll,
      outcome: o.outcome,
    };
    return verify;
  });

  app.post<{ Params: { id: string } }>("/game/missions/:id/insurance", async (request) => {
    const user = requireTos(request);
    const rows = await ctx.db
      .select()
      .from(missions)
      .where(eq(missions.id, request.params.id))
      .limit(1);
    const mission = rows[0];
    if (!mission || mission.userId !== user.id) throw notFound("mission not found");
    if (mission.state !== "active") throw conflict("MISSION_NOT_ACTIVE", "mission already resolved");
    if (mission.insurance) throw conflict("ALREADY_INSURED", "insurance already purchased");

    const location = await getLocation(ctx, mission.locationSlug);
    if (!location.config.rektCapable || location.config.insuranceBps <= 0) {
      throw badRequest("NOT_INSURABLE", "this location cannot rekt characters");
    }
    const cutoffMs = ctx.clock.gameMinutesToMs(POLICY.insuranceCutoffMinutes);
    if (Date.now() > mission.resolvesAt.getTime() - cutoffMs) {
      throw conflict("TOO_LATE", "insurance closes 5 minutes before resolution");
    }

    const price = insurancePrice(mission.stake, location.config);
    const balances = await unlockedBalance(ctx.db, ctx.ledger, user.id);
    if (balances.unlocked < price) throw insufficientFunds();
    const account = await getUserAccount(ctx.ledger, user.id);
    await ctx.ledger.postTransaction(
      [
        { accountId: account, delta: -price },
        { accountId: ctx.accounts.burn_pool, delta: price },
      ],
      { idempotencyKey: `insurance:${mission.id}`, refType: "insurance", refId: mission.id },
    );
    await ctx.db.update(missions).set({ insurance: true }).where(eq(missions.id, mission.id));
    return { ok: true, price: price.toString() };
  });

  app.post<{ Params: { id: string } }>("/game/missions/:id/bribe", async (request) => {
    const user = requireTos(request);
    const rows = await ctx.db
      .select()
      .from(missions)
      .where(eq(missions.id, request.params.id))
      .limit(1);
    const mission = rows[0];
    if (!mission || mission.userId !== user.id) throw notFound("mission not found");
    if (mission.state !== "active") throw conflict("MISSION_NOT_ACTIVE", "mission already resolved");
    if (mission.bribed) throw conflict("ALREADY_BRIBED", "one bribe per mission");
    if (Date.now() >= mission.resolvesAt.getTime()) {
      throw conflict("TOO_LATE", "mission is already due");
    }

    const location = await getLocation(ctx, mission.locationSlug);
    const bribeBps = Number((await getKv<number>(ctx.db, "bribe_bps")) ?? 300);
    const price = applyBps(mission.stake, bribeBps);
    if (price <= 0n) throw badRequest("BRIBE_TOO_SMALL", "stake too small to bribe anyone");
    const balances = await unlockedBalance(ctx.db, ctx.ledger, user.id);
    if (balances.unlocked < price) throw insufficientFunds();

    // 75% burned, 25% split across the patrolling hounds (all burn when none).
    const shift = await activePatrolsAt(ctx, mission.locationSlug);
    const account = await getUserAccount(ctx.ledger, user.id);
    const deltas = new Map<string, bigint>([[account, -price]]);
    const add = (id: string, d: bigint) => {
      if (d !== 0n) deltas.set(id, (deltas.get(id) ?? 0n) + d);
    };
    let paidToHounds = 0n;
    if (shift.length > 0) {
      const houndCut = applyBps(price, POLICY.bribeSplit.patrolBps);
      const totalWeight = BigInt(Math.round(shift.reduce((s, p) => s + p.weight, 0) * 1000));
      for (const patrol of shift) {
        if (totalWeight <= 0n) break;
        const houndRows = await ctx.db
          .select({ ownerUserId: characters.ownerUserId })
          .from(characters)
          .where(eq(characters.id, patrol.characterId))
          .limit(1);
        const ownerId = houndRows[0]?.ownerUserId;
        if (!ownerId) continue;
        const share = (houndCut * BigInt(Math.round(patrol.weight * 1000))) / totalWeight;
        if (share <= 0n) continue;
        add(await getUserAccount(ctx.ledger, ownerId), share);
        paidToHounds += share;
      }
    }
    add(ctx.accounts.burn_pool, price - paidToHounds);

    await ctx.ledger.postTransaction(
      [...deltas.entries()].map(([accountId, delta]) => ({ accountId, delta })),
      { idempotencyKey: `bribe:${mission.id}`, refType: "bribe", refId: mission.id },
    );

    // Halve the patrol-added arrest/confiscation delta for THIS mission only.
    const stats = await missionStats(ctx.db, mission);
    const baseTable = applyStatModifiers(location.config.table, stats);
    const newTable = applyBribe(mission.effectiveTable, baseTable);
    await ctx.db
      .update(missions)
      .set({ bribed: true, effectiveTable: newTable })
      .where(eq(missions.id, mission.id));

    await publishFeed(ctx, {
      type: "bribe",
      locationSlug: mission.locationSlug,
      message: `💸 somebody greased palms at ${location.name} — the heat backs off`,
    });
    return { ok: true, price: price.toString(), effectiveTable: newTable };
  });

  async function missionStats(db: typeof ctx.db, mission: MissionRow): Promise<CharacterStats> {
    if (!mission.characterId) return ZERO_STATS;
    const rows = await db
      .select({ stats: characters.stats })
      .from(characters)
      .where(eq(characters.id, mission.characterId))
      .limit(1);
    return rows[0]?.stats ?? ZERO_STATS;
  }
}
