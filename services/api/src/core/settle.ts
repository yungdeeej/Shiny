/**
 * Lazy mission settlement. The outcome is deterministically fixed at start by
 * (serverSeed, clientSeed, missionId) — settlement just reveals and applies it.
 *
 * Idempotency: the ledger txn key `mission:{id}` is the arbiter. Settlement is
 * recomputed deterministically by every caller; only the first postTransaction
 * applies, and all side-effect writes (outcome row, state flips) are idempotent
 * upserts of identical values, so concurrent settles converge on one settlement.
 */
import {
  resolveMission,
  computePayout,
  rollFromSeeds,
  splitLoss,
  SEASON1,
} from "@trash-wars/economy";
import { JACKPOT, applyBps, POLICY, type MissionOutcome } from "@trash-wars/shared";
import {
  characters,
  jackpotEvents,
  missionOutcomes,
  missions,
  incidents,
  sybilFlags,
  users,
  auditLog,
  type LedgerEntryInput,
} from "@trash-wars/db";
import { and, eq, lte, inArray } from "./orm.js";
import type { AppContext } from "./context.js";
import { decryptSecret } from "./crypto.js";
import { getUserAccount } from "./accounts.js";
import { getCounter, addToCounter, getKv } from "./config.js";
import { utcDayKey } from "./time.js";
import { getLocation, activePatrolsAt } from "./locations.js";
import { amountBand, publishFeed } from "./feed.js";

const JAIL_GAME_HOURS = 24;
/** Patrol weights are doubles; scale to integer thousandths for bigint share math. */
const WEIGHT_SCALE = 1_000;

export interface SettleResult {
  missionId: string;
  userId: string;
  outcome: MissionOutcome;
  payout: bigint;
  roll: number;
  serverSeed: string;
  alreadySettled: boolean;
}

function emissionsKey(now: Date): string {
  return `emissions_spent:${utcDayKey(now)}`;
}

/** Remaining daily emissions budget → how much of `desired` can actually be granted. */
async function clampToEmissions(ctx: AppContext, desired: bigint, now: Date): Promise<bigint> {
  if (desired <= 0n) return 0n;
  const spent = await getCounter(ctx.db, emissionsKey(now));
  const remaining = SEASON1.dailyBudget - spent;
  if (remaining <= 0n) return 0n;
  return desired <= remaining ? desired : remaining;
}

export async function commitEmissions(ctx: AppContext, granted: bigint, now: Date): Promise<void> {
  if (granted > 0n) await addToCounter(ctx.db, emissionsKey(now), granted);
}

export { clampToEmissions };

/**
 * Settle a mission if due. Returns null when the mission doesn't exist or isn't
 * due yet; otherwise the (possibly already-applied) settlement.
 */
export async function settleMission(
  ctx: AppContext,
  missionId: string,
  now = new Date(),
): Promise<SettleResult | null> {
  const missionRows = await ctx.db
    .select()
    .from(missions)
    .where(eq(missions.id, missionId))
    .limit(1);
  const mission = missionRows[0];
  if (!mission) return null;

  if (mission.state === "resolved") {
    const existing = await ctx.db
      .select()
      .from(missionOutcomes)
      .where(eq(missionOutcomes.missionId, missionId))
      .limit(1);
    const o = existing[0];
    if (!o) return null;
    return {
      missionId,
      userId: mission.userId,
      outcome: o.outcome,
      payout: o.payout,
      roll: o.roll,
      serverSeed: o.serverSeed,
      alreadySettled: true,
    };
  }
  if (mission.state === "cancelled") return null;
  if (mission.resolvesAt.getTime() > now.getTime()) return null;
  if (!mission.serverSeedEnc) throw new Error(`mission ${missionId} has no encrypted seed`);

  const location = await getLocation(ctx, mission.locationSlug);
  const serverSeed = decryptSecret(mission.serverSeedEnc, ctx.env.serverSeedEncryptionKey);
  const roll = rollFromSeeds(serverSeed, mission.clientSeed, mission.id);
  const row = resolveMission(mission.effectiveTable, roll);

  let outcome: MissionOutcome = row.outcome;
  const detail: Record<string, unknown> = {
    table: mission.effectiveTable,
    bribed: mission.bribed,
    rolledOutcome: row.outcome,
  };
  if (row.outcome === "rekt_character" && mission.insurance) {
    outcome = "rekt_items";
    detail.insuranceSaved = true;
  }

  const stake = mission.stake;
  const sys = ctx.accounts;
  const userAccount = await getUserAccount(ctx.ledger, mission.userId);

  // Build ledger legs as accountId → delta so duplicate accounts merge cleanly.
  const deltas = new Map<string, bigint>();
  const add = (accountId: string, delta: bigint) => {
    if (delta === 0n) return;
    deltas.set(accountId, (deltas.get(accountId) ?? 0n) + delta);
  };

  let payout = 0n;
  let emissionsGranted = 0n;
  let emissionsClamped = false;
  let jackpotPoolWon = 0n;
  let jackpotPoolAfter = 0n;
  let jackpotPoolTouched = false;
  const bountyAudits: { houndOwnerId: string; share: string }[] = [];

  switch (outcome) {
    case "win":
    case "jackpot": {
      const desiredProfit = computePayout(stake, row) - stake;
      emissionsGranted = await clampToEmissions(ctx, desiredProfit, now);
      emissionsClamped = emissionsGranted < desiredProfit;
      if (emissionsClamped) detail.emissionsClamped = true;
      payout = stake + emissionsGranted;
      add(sys.mission_escrow, -stake);
      add(sys.emissions_budget, -emissionsGranted);
      add(userAccount, payout);

      // v1.1 (specs/03): the jackpot outcome at a jackpotEligible location ALSO
      // wins the progressive pool once jackpot_winnable_at has passed. Pool
      // payout = balance − 10% reset floor; the ledger amount comes from a
      // getBalance read immediately before postTransaction. Concurrent settles
      // cannot double-pay: the `mission:{id}` idempotency key applies the txn
      // exactly once (only the displayed amount can be benignly racy).
      if (outcome === "jackpot" && location.config.jackpotEligible === true) {
        const winnableAtIso = await getKv<string>(ctx.db, "jackpot_winnable_at");
        const winnable = winnableAtIso !== undefined && now.getTime() >= Date.parse(winnableAtIso);
        if (winnable) {
          const pool = await ctx.ledger.getBalance(sys.jackpot_pool);
          const floorHold = applyBps(pool, JACKPOT.resetFloorBps);
          const poolPayout = pool - floorHold;
          if (poolPayout > 0n) {
            add(sys.jackpot_pool, -poolPayout);
            add(userAccount, poolPayout);
            payout += poolPayout;
            jackpotPoolWon = poolPayout;
            jackpotPoolAfter = pool - poolPayout;
            jackpotPoolTouched = true;
            detail.jackpotPoolWon = poolPayout.toString();
          }
        }
      }
      break;
    }
    case "nothing":
    case "arrest": {
      payout = stake;
      add(sys.mission_escrow, -stake);
      add(userAccount, stake);
      break;
    }
    case "confiscation": {
      payout = 0n;
      add(sys.mission_escrow, -stake);
      const shift = await activePatrolsAt(ctx, mission.locationSlug, now);
      let paidToHounds = 0n;
      if (shift.length > 0) {
        const bountyTotal = applyBps(stake, POLICY.patrolBountyBps);
        // Anti-collusion: hounds whose owner shares a sybil cluster with the
        // confiscated raccoon forfeit their share to the global pd_pool.
        const myClusters = await ctx.db
          .select({ clusterKey: sybilFlags.clusterKey })
          .from(sybilFlags)
          .where(eq(sybilFlags.userId, mission.userId));
        const clusterKeys = myClusters.map((c) => c.clusterKey);
        const houndIds = shift.map((p) => p.characterId);
        const houndRows = await ctx.db
          .select()
          .from(characters)
          .where(inArray(characters.id, houndIds));
        const houndById = new Map(houndRows.map((h) => [h.id, h]));
        const totalWeight = BigInt(
          Math.round(shift.reduce((s, p) => s + p.weight, 0) * WEIGHT_SCALE),
        );
        for (const patrol of shift) {
          const hound = houndById.get(patrol.characterId);
          if (!hound || totalWeight <= 0n) continue;
          const share =
            (bountyTotal * BigInt(Math.round(patrol.weight * WEIGHT_SCALE))) / totalWeight;
          if (share <= 0n) continue;
          let colluding = false;
          if (clusterKeys.length > 0) {
            const ownerFlags = await ctx.db
              .select({ clusterKey: sybilFlags.clusterKey })
              .from(sybilFlags)
              .where(
                and(
                  eq(sybilFlags.userId, hound.ownerUserId),
                  inArray(sybilFlags.clusterKey, clusterKeys),
                ),
              );
            colluding = ownerFlags.length > 0;
          }
          if (colluding) {
            bountyAudits.push({ houndOwnerId: hound.ownerUserId, share: share.toString() });
            continue; // share stays in pd_pool
          }
          const ownerAccount = await getUserAccount(ctx.ledger, hound.ownerUserId);
          add(ownerAccount, share);
          paidToHounds += share;
        }
        detail.patrolBounty = { paid: paidToHounds.toString(), hounds: shift.length };
      }
      {
        // S1 v2 + v1.1: confiscations are loss flows like rekts — the remainder
        // after patrol bounties routes through the 3-way splitLoss
        // (94.5% burn / 0.5% PD sliver / 5% jackpot pool, specs/03).
        const { burn, pd, jackpot } = splitLoss(stake - paidToHounds);
        add(sys.burn_pool, burn);
        add(sys.pd_pool, pd);
        add(sys.jackpot_pool, jackpot);
        if (jackpot > 0n) jackpotPoolTouched = true;
      }
      break;
    }
    case "rekt_items":
    case "rekt_character": {
      payout = 0n;
      const { burn, pd, jackpot } = splitLoss(stake);
      add(sys.mission_escrow, -stake);
      add(sys.burn_pool, burn);
      add(sys.pd_pool, pd);
      add(sys.jackpot_pool, jackpot);
      if (jackpot > 0n) jackpotPoolTouched = true;
      if (outcome === "rekt_items") detail.itemsKept = true; // cosmetics survive in s1
      break;
    }
  }

  const entries: LedgerEntryInput[] = [...deltas.entries()].map(([accountId, delta]) => ({
    accountId,
    delta,
  }));

  const refTypeByOutcome: Record<MissionOutcome, string> = {
    win: "mission_payout",
    jackpot: "mission_payout",
    nothing: "mission_refund",
    arrest: "mission_refund",
    confiscation: "mission_confiscation",
    rekt_items: "mission_rekt",
    rekt_character: "mission_rekt",
  };
  const posted = await ctx.ledger.postTransaction(entries, {
    idempotencyKey: `mission:${mission.id}`,
    refType: refTypeByOutcome[outcome],
    refId: mission.id,
  });

  // Deterministic outcome row — identical values from any concurrent settler.
  await ctx.db
    .insert(missionOutcomes)
    .values({ missionId: mission.id, outcome, payout, serverSeed, roll, detail })
    .onConflictDoNothing({ target: missionOutcomes.missionId });
  await ctx.db
    .update(missions)
    .set({ state: "resolved" })
    .where(and(eq(missions.id, mission.id), eq(missions.state, "active")));

  if (posted.applied) {
    await applySideEffects(ctx, {
      mission,
      locationName: location.name,
      outcome,
      payout,
      row,
      emissionsGranted,
      emissionsClamped,
      bountyAudits,
      stake,
      now,
      jackpotPoolWon,
      jackpotPoolAfter,
      jackpotPoolTouched,
    });
  }

  return {
    missionId: mission.id,
    userId: mission.userId,
    outcome,
    payout,
    roll,
    serverSeed,
    alreadySettled: !posted.applied,
  };
}

interface SideEffectArgs {
  mission: typeof missions.$inferSelect;
  locationName: string;
  outcome: MissionOutcome;
  payout: bigint;
  row: { multiplierBps?: number };
  emissionsGranted: bigint;
  emissionsClamped: boolean;
  bountyAudits: { houndOwnerId: string; share: string }[];
  stake: bigint;
  now: Date;
  /** v1.1: progressive-pool payout included in `payout` (0n when not won). */
  jackpotPoolWon: bigint;
  jackpotPoolAfter: bigint;
  /** v1.1: any jackpot_pool leg applied (loss slice or pool win). */
  jackpotPoolTouched: boolean;
}

async function applySideEffects(ctx: AppContext, args: SideEffectArgs): Promise<void> {
  const { mission, outcome, now } = args;

  await commitEmissions(ctx, args.emissionsGranted, now);
  if (args.emissionsClamped) {
    await ctx.db.insert(incidents).values({
      kind: "emissions_budget_exhausted",
      severity: "warn",
      detail: { missionId: mission.id, granted: args.emissionsGranted.toString() },
    });
  }
  for (const audit of args.bountyAudits) {
    await ctx.db.insert(auditLog).values({
      actor: "system",
      action: "patrol_bounty_skipped_sybil",
      detail: { missionId: mission.id, ...audit },
    });
  }

  // Character state transition.
  let characterName: string | null = null;
  if (mission.characterId) {
    const charRows = await ctx.db
      .select()
      .from(characters)
      .where(eq(characters.id, mission.characterId))
      .limit(1);
    const char = charRows[0];
    characterName = char?.name ?? null;
    if (char) {
      if (outcome === "arrest") {
        await ctx.db
          .update(characters)
          .set({
            status: "jailed",
            jailedUntil: new Date(now.getTime() + ctx.clock.gameHoursToMs(JAIL_GAME_HOURS)),
          })
          .where(eq(characters.id, char.id));
      } else if (outcome === "rekt_character") {
        await ctx.db
          .update(characters)
          .set({ status: "dead", stationedAt: null })
          .where(eq(characters.id, char.id));
        if (char.nftMint) {
          await ctx.chain.burnAsset(char.nftMint).catch((err) => {
            ctx.log.error({ err, characterId: char.id }, "nft burn failed");
          });
        }
      } else {
        await ctx.db
          .update(characters)
          .set({ status: "idle" })
          .where(and(eq(characters.id, char.id), eq(characters.status, "on_mission")));
      }
    }
  }

  // Feed (anonymized noir flavor) + private user event.
  const userRows = await ctx.db
    .select({ handle: users.handle, anonymous: users.feedAnonymous })
    .from(users)
    .where(eq(users.id, mission.userId))
    .limit(1);
  const handle = userRows[0]?.anonymous ? "a masked stranger" : (userRows[0]?.handle ?? "someone");
  const name = characterName ?? handle;
  const loc = args.locationName;
  const mult = (args.row.multiplierBps ?? 10_000) / 10_000;

  // v1.1 (specs/03): the vault falls — pool-win event row + dedicated feed moment.
  if (args.jackpotPoolWon > 0n) {
    await ctx.db.insert(jackpotEvents).values({
      kind: "win",
      missionId: mission.id,
      userId: mission.userId,
      amount: args.jackpotPoolWon,
      poolAfter: args.jackpotPoolAfter,
    });
    try {
      await publishFeed(ctx, {
        type: "jackpot",
        locationSlug: mission.locationSlug,
        actor: handle,
        amountBand: amountBand(args.jackpotPoolWon),
        message: `🏦 THE VAULT FALLS — ${handle} cleans out ${amountBand(args.jackpotPoolWon)}`,
      });
    } catch (err) {
      ctx.log.error({ err, missionId: mission.id }, "jackpot feed publish failed");
    }
    ctx.bus.emitUser(mission.userId, {
      type: "jackpot_won",
      missionId: mission.id,
      amount: args.jackpotPoolWon.toString(),
      poolAfter: args.jackpotPoolAfter.toString(),
    });
  }
  if (args.jackpotPoolTouched) ctx.bus.emitJackpot();

  try {
    switch (outcome) {
      case "win":
        await publishFeed(ctx, {
          type: "win",
          locationSlug: mission.locationSlug,
          actor: handle,
          multiplierBps: args.row.multiplierBps,
          amountBand: amountBand(args.payout),
          message: `🦝 ${handle} hit ${mult}× at ${loc}`,
        });
        break;
      case "jackpot":
        await publishFeed(ctx, {
          type: "jackpot",
          locationSlug: mission.locationSlug,
          actor: handle,
          multiplierBps: args.row.multiplierBps,
          amountBand: amountBand(args.payout),
          message: `💎 JACKPOT — ${handle} cleaned out ${loc} for ${mult}×`,
        });
        break;
      case "arrest":
        await publishFeed(ctx, {
          type: "arrest",
          locationSlug: mission.locationSlug,
          message: `🚔 ${name} got pinched at ${loc} — 24h in the tank`,
        });
        break;
      case "confiscation":
        await publishFeed(ctx, {
          type: "confiscation",
          locationSlug: mission.locationSlug,
          amountBand: amountBand(args.stake),
          message: `🐕 PD seized ${amountBand(args.stake)} at ${loc}`,
        });
        break;
      case "rekt_items":
        await publishFeed(ctx, {
          type: "rekt",
          locationSlug: mission.locationSlug,
          amountBand: amountBand(args.stake),
          message: `💥 ${name} got rekt at ${loc} — the haul is gone`,
        });
        break;
      case "rekt_character":
        await publishFeed(ctx, {
          type: "death",
          locationSlug: mission.locationSlug,
          message: `💀 ${name} didn't make it out of ${loc}`,
        });
        break;
      case "nothing":
        break;
    }
  } catch (err) {
    ctx.log.error({ err, missionId: mission.id }, "feed publish failed");
  }

  // Emitted ONLY when the ledger txn applied (posted.applied) — settlement
  // replays therefore never double-grant Season Pass XP (specs/02).
  ctx.bus.emitUser(mission.userId, {
    type: "mission_resolved",
    missionId: mission.id,
    outcome,
    payout: args.payout.toString(),
    locationSlug: mission.locationSlug,
    at: now.getTime(),
  });
}

/** Sweep: settle every due mission (scheduler tick + API lazy path share this). */
export async function settleDueMissions(ctx: AppContext, now = new Date()): Promise<number> {
  const due = await ctx.db
    .select({ id: missions.id })
    .from(missions)
    .where(and(eq(missions.state, "active"), lte(missions.resolvesAt, now)))
    .limit(200);
  let settled = 0;
  for (const m of due) {
    try {
      const result = await settleMission(ctx, m.id, now);
      if (result && !result.alreadySettled) settled += 1;
    } catch (err) {
      ctx.log.error({ err, missionId: m.id }, "mission settlement failed");
    }
  }
  return settled;
}
