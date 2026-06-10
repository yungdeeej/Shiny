import { z } from "zod";
import { tokenAmount } from "./amounts.js";
import { credTier } from "./cred.js";

/* ── Core enums ───────────────────────────────────────────────────── */

export const faction = z.enum(["raccoon", "bloodhound", "crow"]);
export type Faction = z.infer<typeof faction>;

export const characterStatus = z.enum([
  "idle",
  "on_mission",
  "jailed",
  "on_patrol",
  "listed",
  "dead",
]);
export type CharacterStatus = z.infer<typeof characterStatus>;

export const missionOutcome = z.enum([
  "win",
  "jackpot",
  "nothing",
  "arrest",
  "confiscation",
  "rekt_items",
  "rekt_character",
]);
export type MissionOutcome = z.infer<typeof missionOutcome>;

export const missionState = z.enum(["active", "resolving", "resolved", "cancelled"]);
export type MissionState = z.infer<typeof missionState>;

export const heatBand = z.enum(["none", "low", "med", "high", "blazing"]);
export type HeatBand = z.infer<typeof heatBand>;

export const statKey = z.enum(["stealth", "muscle", "luck", "reputation"]);
export type StatKey = z.infer<typeof statKey>;

export const characterStats = z.object({
  stealth: z.number().int().min(0),
  muscle: z.number().int().min(0),
  luck: z.number().int().min(0),
  reputation: z.number().int().min(0),
});
export type CharacterStats = z.infer<typeof characterStats>;

export const ZERO_STATS: CharacterStats = { stealth: 0, muscle: 0, luck: 0, reputation: 0 };

/* ── Probability tables ───────────────────────────────────────────── */

/**
 * A table row. Probabilities are basis points (sum of a table = 10_000).
 * multiplierBps applies to outcomes that pay (win/jackpot): payout = stake * multiplierBps / 10_000.
 */
export const outcomeRow = z.object({
  outcome: missionOutcome,
  probabilityBps: z.number().int().min(0).max(10_000),
  multiplierBps: z.number().int().min(0).optional(),
});
export type OutcomeRow = z.infer<typeof outcomeRow>;

export const probabilityTable = z
  .array(outcomeRow)
  .refine((rows) => rows.reduce((s, r) => s + r.probabilityBps, 0) === 10_000, {
    message: "probability table must sum to 10000 bps",
  });
export type ProbabilityTable = z.infer<typeof probabilityTable>;

/* ── Locations ────────────────────────────────────────────────────── */

export const locationConfig = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string(),
  durationHours: z.number().positive(),
  minStake: tokenAmount,
  maxStake: tokenAmount,
  table: probabilityTable,
  requiresCharacter: z.boolean(),
  freeTierAllowed: z.boolean(),
  rektCapable: z.boolean(),
  insuranceBps: z.number().int().min(0),
  idleRatePerHour: tokenAmount,
  /** PvP: aggregate patrol weight cap and table-shift caps (bps). */
  patrolWeightCap: z.number().min(0),
  capArrestShiftBps: z.number().int().min(0),
  capConfShiftBps: z.number().int().min(0),
  enabled: z.boolean().default(true),
  /** v1.1 (specs/01): minimum Street Cred tier required to start missions here. */
  minTier: credTier.optional(),
  /** v1.1 (specs/03): this location's `jackpot` outcome also wins the progressive pool. */
  jackpotEligible: z.boolean().optional(),
});
export type LocationConfig = z.infer<typeof locationConfig>;

export const locationLive = locationConfig.extend({
  heat: heatBand,
  playersActive: z.number().int().min(0),
  /** Table after live patrol modifiers — what the player will actually get. */
  effectiveTable: probabilityTable,
});
export type LocationLive = z.infer<typeof locationLive>;

/* ── Missions ─────────────────────────────────────────────────────── */

export const missionStartRequest = z.object({
  locationSlug: z.string(),
  characterId: z.string().uuid().optional(),
  stake: tokenAmount,
  clientSeed: z.string().max(64).optional(),
});
export type MissionStartRequest = z.infer<typeof missionStartRequest>;

export const mission = z.object({
  id: z.string(),
  locationSlug: z.string(),
  characterId: z.string().nullable(),
  stake: tokenAmount,
  state: missionState,
  serverSeedHash: z.string(),
  clientSeed: z.string(),
  effectiveTable: probabilityTable,
  insurance: z.boolean(),
  bribed: z.boolean(),
  startedAt: z.string(),
  resolvesAt: z.string(),
});
export type Mission = z.infer<typeof mission>;

export const missionResult = z.object({
  missionId: z.string(),
  outcome: missionOutcome,
  payout: tokenAmount,
  /** Revealed after resolution — verifiable. */
  serverSeed: z.string(),
  detail: z.record(z.unknown()).optional(),
});
export type MissionResult = z.infer<typeof missionResult>;

export const missionVerify = z.object({
  missionId: z.string(),
  serverSeedHash: z.string(),
  serverSeed: z.string(),
  clientSeed: z.string(),
  algorithm: z.string(),
  table: probabilityTable,
  roll: z.number(),
  outcome: missionOutcome,
});
export type MissionVerify = z.infer<typeof missionVerify>;

/* ── Characters ───────────────────────────────────────────────────── */

export const character = z.object({
  id: z.string(),
  name: z.string(),
  faction,
  level: z.number().int().min(1),
  stats: characterStats,
  status: characterStatus,
  stationedAt: z.string().nullable(),
  jailedUntil: z.string().nullable(),
  patrolEndsAt: z.string().nullable().optional(),
  nftMint: z.string().nullable(),
  inGame: z.boolean(),
  lastClaimedAt: z.string().nullable(),
  /** Deterministic appearance seed — drives the layered SVG art. */
  dna: z.string(),
  cosmetics: z.array(z.string()).default([]),
});
export type Character = z.infer<typeof character>;

export const mintEvent = z.object({
  id: z.string(),
  faction,
  price: tokenAmount,
  supply: z.number().int().positive(),
  remaining: z.number().int().min(0),
  opensAt: z.string(),
  closesAt: z.string(),
  state: z.enum(["upcoming", "open", "soldout", "closed"]),
});
export type MintEvent = z.infer<typeof mintEvent>;

/* ── Feed ─────────────────────────────────────────────────────────── */

export const feedEvent = z.object({
  id: z.string(),
  type: z.enum([
    "jackpot",
    "win",
    "rekt",
    "death",
    "arrest",
    "confiscation",
    "mint",
    "raffle",
    "burn",
    "patrol",
    "bribe",
  ]),
  locationSlug: z.string().optional(),
  actor: z.string().optional(),
  multiplierBps: z.number().optional(),
  amountBand: z.string().optional(),
  message: z.string(),
  at: z.string(),
});
export type FeedEvent = z.infer<typeof feedEvent>;
