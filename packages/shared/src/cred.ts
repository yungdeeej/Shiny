import { z } from "zod";
import { tokenAmount, toBaseUnits } from "./amounts.js";

/* ════════════════════════════════════════════════════════════════════
   v1.1 launch-scope contract: Street Cred tiers, Season Pass,
   Progressive Jackpot (docs/14 + docs/specs/01–03).
   ════════════════════════════════════════════════════════════════════ */

/* ── Street Cred (holder tiers, specs/01) ─────────────────────────── */

export const credTier = z.enum(["none", "alley", "block", "district", "borough", "kingpin"]);
export type CredTier = z.infer<typeof credTier>;

export interface TierPerks {
  /** Concurrent missions per user (base 1). */
  missionSlots: number;
  withdrawalFeeBps: number;
  bailDiscountBps: number;
  /** Hours of early access to mint waves. */
  mintEarlyAccessHours: number;
  weeklyRaffleTickets: number;
  penthouseAccess: boolean;
  freeTierAccess: boolean;
}

export const TIER_ORDER: CredTier[] = ["none", "alley", "block", "district", "borough", "kingpin"];

/** Cumulative perk table — single source of truth for both clients and API. */
export const TIER_DEFINITIONS: Record<CredTier, { minHeld: bigint; perks: TierPerks }> = {
  none: {
    minHeld: 0n,
    perks: {
      missionSlots: 1,
      withdrawalFeeBps: 500,
      bailDiscountBps: 0,
      mintEarlyAccessHours: 0,
      weeklyRaffleTickets: 0,
      penthouseAccess: false,
      freeTierAccess: false,
    },
  },
  alley: {
    minHeld: toBaseUnits(10_000),
    perks: {
      missionSlots: 1,
      withdrawalFeeBps: 500,
      bailDiscountBps: 0,
      mintEarlyAccessHours: 0,
      weeklyRaffleTickets: 0,
      penthouseAccess: false,
      freeTierAccess: true,
    },
  },
  block: {
    minHeld: toBaseUnits(50_000),
    perks: {
      missionSlots: 2,
      withdrawalFeeBps: 500,
      bailDiscountBps: 1_000,
      mintEarlyAccessHours: 0,
      weeklyRaffleTickets: 0,
      penthouseAccess: false,
      freeTierAccess: true,
    },
  },
  district: {
    minHeld: toBaseUnits(250_000),
    perks: {
      missionSlots: 2,
      withdrawalFeeBps: 400,
      bailDiscountBps: 1_000,
      mintEarlyAccessHours: 1,
      weeklyRaffleTickets: 0,
      penthouseAccess: false,
      freeTierAccess: true,
    },
  },
  borough: {
    minHeld: toBaseUnits(1_000_000),
    perks: {
      missionSlots: 3,
      withdrawalFeeBps: 300,
      bailDiscountBps: 1_000,
      mintEarlyAccessHours: 1,
      weeklyRaffleTickets: 1,
      penthouseAccess: false,
      freeTierAccess: true,
    },
  },
  kingpin: {
    minHeld: toBaseUnits(5_000_000),
    perks: {
      missionSlots: 3,
      withdrawalFeeBps: 200,
      bailDiscountBps: 1_000,
      mintEarlyAccessHours: 1,
      weeklyRaffleTickets: 1,
      penthouseAccess: true,
      freeTierAccess: true,
    },
  },
};

export function tierForHolding(held: bigint): CredTier {
  let result: CredTier = "none";
  for (const tier of TIER_ORDER) {
    if (held >= TIER_DEFINITIONS[tier].minHeld) result = tier;
  }
  return result;
}

export function nextTier(tier: CredTier): CredTier | null {
  const i = TIER_ORDER.indexOf(tier);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1]! : null;
}

export const CRED_POLICY = {
  /** Downgrades apply only after this long below threshold (anti-flicker). */
  downgradeGraceHours: 24,
  /** Threshold changes (either direction) require this much public notice. */
  thresholdNoticeDays: 7,
  holdingCacheMinutes: 5,
} as const;

export const credInfo = z.object({
  tier: credTier,
  heldBalance: tokenAmount,
  nextTier: credTier.nullable(),
  /** How much more $SHINY to hold to reach nextTier. */
  shortfall: tokenAmount.nullable(),
  /** Set while a downgrade is pending in the grace window. */
  graceUntil: z.string().nullable(),
  perks: z.object({
    missionSlots: z.number().int(),
    withdrawalFeeBps: z.number().int(),
    bailDiscountBps: z.number().int(),
    mintEarlyAccessHours: z.number(),
    weeklyRaffleTickets: z.number().int(),
    penthouseAccess: z.boolean(),
    freeTierAccess: z.boolean(),
  }),
});
export type CredInfo = z.infer<typeof credInfo>;

/* ── Progressive Jackpot (specs/03) ───────────────────────────────── */

export const JACKPOT = {
  /** Share of every lost stake routed to the pool (part of lossSplit). */
  lossShareBps: 500,
  /** Day-0 seed from the marketing tranche (in-game ledger event). */
  seedAmount: toBaseUnits(2_000_000),
  /** Holdback on win — the pool never resets to zero. */
  resetFloorBps: 1_000,
  /** Becomes winnable when The Mint opens (S1 wk8). */
  winnableGameDay: 56,
} as const;

export const jackpotState = z.object({
  pool: tokenAmount,
  winnable: z.boolean(),
  winnableAt: z.string(),
  seeded: tokenAmount,
  hits: z.number().int(),
  lastWinner: z
    .object({ handle: z.string(), amount: tokenAmount, at: z.string() })
    .nullable(),
});
export type JackpotState = z.infer<typeof jackpotState>;

/* ── Season Pass (specs/02) ───────────────────────────────────────── */

export const PASS = {
  priceSol: 0.3,
  levels: 50,
  xpPerLevel: 100,
  xp: {
    missionResolved: 20,
    bailPaid: 10,
    raffleTicket: 5,
    raffleTicketDailyCap: 25,
    patrolCompleted: 15,
    dailyFirstMission: 30,
    weeklyChallenge: 150,
  },
  challengesPerWeek: 3,
} as const;

export const passRewardKind = z.enum([
  "cosmetic",
  "insurance_voucher",
  "raffle_fragments",
  "nameplate",
]);
export type PassRewardKind = z.infer<typeof passRewardKind>;

export const passReward = z.object({
  id: z.string(),
  level: z.number().int(),
  track: z.enum(["free", "premium"]),
  kind: passRewardKind,
  refSlug: z.string().nullable(),
  amount: z.number().int().nullable(),
  claimed: z.boolean(),
  claimable: z.boolean(),
});

export const passChallenge = z.object({
  id: z.string(),
  slug: z.string(),
  description: z.string(),
  week: z.number().int(),
  target: z.number().int(),
  progress: z.number().int(),
  xp: z.number().int(),
  completed: z.boolean(),
});

export const passState = z.object({
  season: z.number().int(),
  premium: z.boolean(),
  level: z.number().int(),
  xp: z.number().int(),
  xpIntoLevel: z.number().int(),
  xpPerLevel: z.number().int(),
  insuranceVouchers: z.number().int(),
  rewards: z.array(passReward),
  challenges: z.array(passChallenge),
});
export type PassState = z.infer<typeof passState>;
