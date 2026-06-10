/**
 * Season 1 "First Score" — frozen location tables (doc 01).
 * Validated with the shared zod schema at module load; an invalid table throws
 * before anything can import it.
 */
import { z } from "zod";
import { SUPPLY, locationConfig, toBaseUnits, type LocationConfig } from "@trash-wars/shared";
import { computeEmissionCostBps } from "../resolve.js";

/** Whole SHINY -> base-unit string (the wire format used by LocationConfig). */
const units = (whole: number): string => toBaseUnits(whole).toString();

const RAW_LOCATIONS = [
  {
    slug: "corner-store",
    name: "Corner Store",
    tagline: "Smash and grab. Training wheels for trash pandas.",
    durationHours: 2,
    minStake: units(100),
    maxStake: units(10_000),
    table: [
      { outcome: "win", probabilityBps: 7_000, multiplierBps: 14_000 },
      { outcome: "nothing", probabilityBps: 2_500 },
      { outcome: "arrest", probabilityBps: 500 },
    ],
    requiresCharacter: false,
    freeTierAllowed: true,
    rektCapable: false,
    insuranceBps: 0,
    idleRatePerHour: units(30),
    patrolWeightCap: 4,
    capArrestShiftBps: 400,
    capConfShiftBps: 300,
    enabled: true,
  },
  {
    slug: "pawn-shop",
    name: "Pawn Shop",
    tagline: "Fence the goods before the fence fences you.",
    durationHours: 4,
    minStake: units(250),
    maxStake: units(25_000),
    table: [
      { outcome: "win", probabilityBps: 5_500, multiplierBps: 18_000 },
      { outcome: "nothing", probabilityBps: 2_800 },
      { outcome: "arrest", probabilityBps: 1_200 },
      { outcome: "confiscation", probabilityBps: 500 },
    ],
    requiresCharacter: true,
    freeTierAllowed: false,
    rektCapable: false,
    insuranceBps: 0,
    idleRatePerHour: units(50),
    patrolWeightCap: 5,
    capArrestShiftBps: 500,
    capConfShiftBps: 400,
    enabled: true,
  },
  {
    slug: "jewelry-district",
    name: "Jewelry District",
    tagline: "Glass cases, silent alarms, shiny things.",
    durationHours: 6,
    minStake: units(500),
    maxStake: units(50_000),
    table: [
      { outcome: "win", probabilityBps: 4_500, multiplierBps: 24_000 },
      { outcome: "nothing", probabilityBps: 2_500 },
      { outcome: "arrest", probabilityBps: 1_800 },
      { outcome: "confiscation", probabilityBps: 1_000 },
      { outcome: "rekt_items", probabilityBps: 200 },
    ],
    requiresCharacter: true,
    freeTierAllowed: false,
    rektCapable: true,
    insuranceBps: 800,
    idleRatePerHour: units(75),
    patrolWeightCap: 6,
    capArrestShiftBps: 600,
    capConfShiftBps: 500,
    enabled: true,
  },
  {
    slug: "armored-truck",
    name: "Armored Truck",
    tagline: "Rolling vault. Bring muscle.",
    durationHours: 8,
    minStake: units(1_000),
    maxStake: units(100_000),
    table: [
      { outcome: "win", probabilityBps: 3_500, multiplierBps: 32_000 },
      { outcome: "nothing", probabilityBps: 2_500 },
      { outcome: "arrest", probabilityBps: 2_200 },
      { outcome: "confiscation", probabilityBps: 1_300 },
      { outcome: "rekt_items", probabilityBps: 500 },
    ],
    requiresCharacter: true,
    freeTierAllowed: false,
    rektCapable: true,
    insuranceBps: 1_000,
    idleRatePerHour: units(100),
    patrolWeightCap: 6,
    capArrestShiftBps: 700,
    capConfShiftBps: 600,
    enabled: true,
  },
  {
    slug: "first-national",
    name: "First National",
    tagline: "The big score. Cops shoot first here.",
    durationHours: 12,
    minStake: units(2_500),
    maxStake: units(250_000),
    table: [
      { outcome: "win", probabilityBps: 2_500, multiplierBps: 50_000 },
      { outcome: "nothing", probabilityBps: 2_500 },
      { outcome: "arrest", probabilityBps: 2_500 },
      { outcome: "confiscation", probabilityBps: 1_700 },
      { outcome: "rekt_items", probabilityBps: 200 },
      { outcome: "rekt_character", probabilityBps: 600 },
    ],
    requiresCharacter: true,
    freeTierAllowed: false,
    rektCapable: true,
    insuranceBps: 1_200,
    idleRatePerHour: units(140),
    patrolWeightCap: 8,
    capArrestShiftBps: 800,
    capConfShiftBps: 700,
    enabled: true,
  },
  {
    slug: "the-mint",
    name: "The Mint",
    tagline: "Print your own luck. Jackpot or body bag.",
    durationHours: 24,
    minStake: units(5_000),
    maxStake: units(500_000),
    table: [
      { outcome: "win", probabilityBps: 1_200, multiplierBps: 50_000 },
      { outcome: "jackpot", probabilityBps: 300, multiplierBps: 120_000 },
      { outcome: "nothing", probabilityBps: 3_000 },
      { outcome: "arrest", probabilityBps: 3_000 },
      { outcome: "confiscation", probabilityBps: 1_800 },
      { outcome: "rekt_character", probabilityBps: 700 },
    ],
    requiresCharacter: true,
    freeTierAllowed: false,
    rektCapable: true,
    insuranceBps: 1_500,
    idleRatePerHour: units(200),
    patrolWeightCap: 10,
    capArrestShiftBps: 900,
    capConfShiftBps: 800,
    enabled: true,
  },
];

/** Zod-validated at module load — throws on any invalid table. */
export const SEASON1_LOCATIONS: LocationConfig[] = z.array(locationConfig).parse(RAW_LOCATIONS);

const S1 = SUPPLY.seasons[0];

export const SEASON1 = {
  index: 1,
  name: S1.name,
  days: S1.days,
  emissions: S1.emissions,
  dailyBudget: S1.emissions / BigInt(S1.days),
} as const;

export interface SeasonInvariantOpts {
  /** Daily active users assumed for the projection. */
  dau: number;
  /** Average stake per mission, base units. */
  avgStake: bigint;
  /** Remaining season emissions budget, base units. */
  remainingBudget: bigint;
  /** Remaining days in the season. */
  remainingDays: number;
}

export type SeasonInvariantResult = { ok: true } | { ok: false; reason: string };

/** Engagement assumption used by the projection: nobody grinds >3 missions/day per location. */
const MAX_MISSIONS_PER_PLAYER_PER_DAY = 3;
/** Idle-accrual utilization assumption: characters are staked ~50% of the day. */
const IDLE_UTILIZATION_BPS = 5_000n;

/**
 * Constraint engine (doc 01): reject any config where the projected daily EV
 * payout from emissions exceeds (remainingBudget / remainingDays) * 1.1.
 *
 * Projection model (documented, deliberately simple):
 * - DAU split evenly across enabled locations.
 * - Each participant runs min(floor(24/durationHours), 3) missions/day at avgStake.
 * - Emission cost per mission = avgStake * Σ_paying p*(mult-10000)/10^8
 *   (only winnings above the returned stake are paid from the budget;
 *   lost stakes route to burn/PD, not back to the budget).
 * - Idle accrual: idleRatePerHour * 24h * 50% utilization per participant.
 * All money math is bigint.
 */
export function checkSeasonInvariant(
  locations: LocationConfig[],
  opts: SeasonInvariantOpts,
): SeasonInvariantResult {
  if (opts.remainingDays <= 0) return { ok: false, reason: "remainingDays must be > 0" };
  if (opts.dau < 0) return { ok: false, reason: "dau must be >= 0" };
  if (opts.avgStake < 0n) return { ok: false, reason: "avgStake must be >= 0" };

  const enabled = locations.filter((loc) => loc.enabled);
  if (enabled.length === 0) return { ok: true };

  const playersPerLocation = BigInt(Math.floor(opts.dau / enabled.length));
  let projected = 0n;
  for (const loc of enabled) {
    const missionsPerPlayer = BigInt(
      Math.max(1, Math.min(MAX_MISSIONS_PER_PLAYER_PER_DAY, Math.floor(24 / loc.durationHours))),
    );
    const missionCost = (opts.avgStake * BigInt(computeEmissionCostBps(loc.table))) / 10_000n;
    const idleCost = (BigInt(loc.idleRatePerHour) * 24n * IDLE_UTILIZATION_BPS) / 10_000n;
    projected += playersPerLocation * (missionsPerPlayer * missionCost + idleCost);
  }

  const allowed = (opts.remainingBudget * 11n) / (BigInt(Math.floor(opts.remainingDays)) * 10n);
  if (projected > allowed) {
    return {
      ok: false,
      reason:
        `projected daily EV payout ${projected} base units exceeds allowed ${allowed} ` +
        `(= remainingBudget/${opts.remainingDays} * 1.1) at dau=${opts.dau}, avgStake=${opts.avgStake}`,
    };
  }
  return { ok: true };
}
