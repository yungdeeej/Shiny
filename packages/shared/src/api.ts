import { z } from "zod";
import { tokenAmount } from "./amounts.js";
import { character, faction, heatBand } from "./game.js";

/* ── Auth ─────────────────────────────────────────────────────────── */

export const nonceRequest = z.object({ address: z.string().min(32).max(64) });
export const nonceResponse = z.object({ nonce: z.string(), message: z.string() });

export const verifyRequest = z.object({
  address: z.string(),
  signature: z.string(),
  fingerprint: z.string().optional(),
});

export const guestLoginRequest = z.object({
  handle: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/),
});

export const walletInfo = z.object({
  address: z.string(),
  isPrimary: z.boolean(),
  pendingPrimaryAt: z.string().nullable(),
});

export const meResponse = z.object({
  id: z.string(),
  handle: z.string(),
  isGuest: z.boolean(),
  wallets: z.array(walletInfo),
  balance: tokenAmount,
  lockedBalance: tokenAmount,
  tosAcceptedVersion: z.string().nullable(),
  flags: z.array(z.string()),
  role: z.enum(["player", "admin"]),
  createdAt: z.string(),
});
export type MeResponse = z.infer<typeof meResponse>;

/* ── Bank ─────────────────────────────────────────────────────────── */

export const depositIntentRequest = z.object({ amount: tokenAmount });
export const depositIntentResponse = z.object({
  depositAddress: z.string(),
  memo: z.string(),
  serializedTx: z.string().nullable(),
});

export const withdrawRequest = z.object({
  amount: tokenAmount,
  destAddress: z.string(),
});

export const withdrawal = z.object({
  id: z.string(),
  amount: tokenAmount,
  fee: tokenAmount,
  net: tokenAmount,
  destAddress: z.string(),
  state: z.enum(["queued", "review", "sent", "failed", "denied"]),
  txSig: z.string().nullable(),
  createdAt: z.string(),
});
export type Withdrawal = z.infer<typeof withdrawal>;

export const proofOfReserves = z.object({
  at: z.string(),
  onchainReserves: tokenAmount,
  hotWallet: tokenAmount,
  multisig: tokenAmount,
  liabilities: tokenAmount,
  ratioBps: z.number(),
  healthy: z.boolean(),
});
export type ProofOfReserves = z.infer<typeof proofOfReserves>;

/* ── PvP ──────────────────────────────────────────────────────────── */

export const patrolRequest = z.object({
  characterId: z.string(),
  locationSlug: z.string(),
});

export const patrol = z.object({
  id: z.string(),
  characterId: z.string(),
  characterName: z.string(),
  locationSlug: z.string(),
  weight: z.number(),
  shiftEndsAt: z.string(),
});
export type Patrol = z.infer<typeof patrol>;

export const pvpStats = z.object({
  pdPool: tokenAmount,
  trailingApr: z.number(),
  bloodhoundCount: z.number().int(),
  livingCharacters: z.number().int(),
  topHounds: z.array(
    z.object({ name: z.string(), reputation: z.number(), earned: tokenAmount }),
  ),
});
export type PvpStats = z.infer<typeof pvpStats>;

/* ── Store / raffles / market ─────────────────────────────────────── */

export const cosmeticSlot = z.enum(["hat", "coat", "mask", "companion", "banner", "nameplate"]);
export type CosmeticSlot = z.infer<typeof cosmeticSlot>;

export const cosmeticItem = z.object({
  slug: z.string(),
  name: z.string(),
  slot: cosmeticSlot,
  rarity: z.enum(["common", "rare", "epic", "legendary"]),
  priceShiny: tokenAmount.nullable(),
  priceSol: z.number().nullable(),
  supplyCap: z.number().int().nullable(),
  remaining: z.number().int().nullable(),
  season: z.number().int(),
  description: z.string(),
});
export type CosmeticItem = z.infer<typeof cosmeticItem>;

export const raffle = z.object({
  id: z.string(),
  type: z.enum(["recruitment", "cosmetic"]),
  title: z.string(),
  prize: z.record(z.unknown()),
  ticketPrice: tokenAmount,
  ticketsSold: z.number().int(),
  maxTickets: z.number().int().nullable(),
  myTickets: z.number().int().optional(),
  opensAt: z.string(),
  drawsAt: z.string(),
  state: z.enum(["upcoming", "open", "drawing", "drawn"]),
  serverSeedHash: z.string(),
  winners: z.array(z.string()).nullable(),
});
export type Raffle = z.infer<typeof raffle>;

export const listing = z.object({
  id: z.string(),
  kind: z.enum(["character", "cosmetic"]),
  sellerHandle: z.string(),
  refId: z.string(),
  price: tokenAmount,
  state: z.enum(["active", "sold", "delisted"]),
  character: character.nullable().optional(),
  cosmeticSlug: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type Listing = z.infer<typeof listing>;

/* ── Public stats / leaderboard ───────────────────────────────────── */

export const publicStats = z.object({
  circulating: tokenAmount,
  burnedTotal: tokenAmount,
  burnedThisWeek: tokenAmount,
  emissionsSpent: tokenAmount,
  emissionsBudget: tokenAmount,
  seasonDay: z.number().int(),
  seasonLengthDays: z.number().int(),
  pdApr: z.number(),
  players: z.number().int(),
  missionsToday: z.number().int(),
  biggestHeistThisWeek: tokenAmount,
  treasuryRake: tokenAmount,
});
export type PublicStats = z.infer<typeof publicStats>;

export const leaderboardEntry = z.object({
  rank: z.number().int(),
  handle: z.string(),
  faction: faction.nullable(),
  value: tokenAmount,
  detail: z.string().optional(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntry>;

export const leaderboardResponse = z.object({
  board: z.enum(["earners", "hounds", "heists", "most_wanted"]),
  entries: z.array(leaderboardEntry),
});

/* ── Error envelope ───────────────────────────────────────────────── */

export const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelope>;

export const heatResponse = z.record(heatBand);
