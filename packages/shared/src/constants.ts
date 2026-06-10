import { toBaseUnits } from "./amounts.js";

/** Season 1 sink prices and policy knobs (doc 01). All in base units (6 decimals). */
export const SINKS = {
  mintRaccoon: toBaseUnits(25_000),
  mintBloodhound: toBaseUnits(60_000),
  statUpgradeBase: toBaseUnits(500),
  statUpgradeGrowth: 1.35,
  jailBail: toBaseUnits(1_500),
  raffleTicket: toBaseUnits(1_000),
  nameChange: toBaseUnits(250),
} as const;

export const POLICY = {
  withdrawalFeeBps: 500,
  minWithdrawal: toBaseUnits(5_000),
  marketplaceFeeBps: 1_000, // 50% burn / 50% treasury
  bloodhoundCapBps: 1_000, // 10% of living characters
  freeTierMinHolding: toBaseUnits(10_000),
  freeTierCooldownHours: 8,
  freeTierMaxStake: toBaseUnits(5_000),
  jailHours: 24,
  idleClaimCapHours: 24,
  bailSplit: { burnBps: 7_500, pdBps: 2_500 },
  lossSplit: { burnBps: 5_000, pdBps: 5_000 },
  bribeSplit: { burnBps: 7_500, patrolBps: 2_500 },
  patrolShiftHours: 6,
  patrolBountyBps: 4_000, // 40% of patrolled-location confiscations to the shift
  pdDailyDistributionBps: 8_000, // distribute 80% of pool, keep 20% buffer
  insuranceCutoffMinutes: 5,
  statLevelCapS1: 10,
} as const;

export const SUPPLY = {
  total: toBaseUnits(1_000_000_000),
  emissionsReserve: toBaseUnits(700_000_000),
  seasons: [
    { name: "S1 First Score", days: 90, emissions: toBaseUnits(210_000_000) },
    { name: "S2 Murder of Crows", days: 90, emissions: toBaseUnits(140_000_000) },
    { name: "S3 The Syndicates", days: 90, emissions: toBaseUnits(84_000_000) },
    { name: "S4 Lockdown", days: 90, emissions: toBaseUnits(56_000_000) },
  ],
} as const;

/** Stat effects (doc 01/06). Applied per level at resolution. */
export const STAT_EFFECTS = {
  stealthArrestReductionBpsPerLevel: 150, // -1.5% arrest probability per level
  muscleMultiplierBpsPerLevel: 200, // +2% payout multiplier per level
  muscleMultiplierCapBps: 2_000, // capped at +20%
  luckJackpotBpsPerLevel: 30, // +0.3% jackpot probability per level
  patrolArrestBpsPerWeight: 80, // +0.8% arrest per patrol weight
  patrolConfBpsPerWeight: 60, // +0.6% confiscation per patrol weight
  reputationWeightPerLevel: 0.2, // patrol weight = 1 + rep * 0.2
  reputationYieldPerLevel: 0.25, // pd pool share weight = 1 + rep * 0.25
} as const;

export const TOS_VERSION = "2026-06-beta-1";

export const HEAT_THRESHOLDS = [
  { band: "none", max: 0 },
  { band: "low", max: 1.5 },
  { band: "med", max: 3.5 },
  { band: "high", max: 6 },
  { band: "blazing", max: Infinity },
] as const;
