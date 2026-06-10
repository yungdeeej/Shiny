/**
 * Additional request/query schemas for the Trash Wars backend (services/api).
 * Added alongside api.ts — never modifies existing contracts, only extends them.
 */
import { z } from "zod";
import { tokenAmount } from "./amounts.js";
import { statKey } from "./game.js";
import { credTier } from "./cred.js";

/* ── auth / me ────────────────────────────────────────────────────── */

export const acceptTosRequest = z.object({ version: z.string().min(1).max(64) });

/* ── characters ───────────────────────────────────────────────────── */

export const stationRequest = z.object({ locationSlug: z.string().nullable() });
export const upgradeRequest = z.object({ stat: statKey });
export const renameRequest = z.object({
  name: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9 _'-]+$/),
});

/* ── mint ─────────────────────────────────────────────────────────── */

export const mintRequest = z.object({ eventId: z.string().uuid() });

/* ── store / raffles / market ─────────────────────────────────────── */

export const storeBuyRequest = z.object({ itemSlug: z.string().min(1).max(64) });
export const equipRequest = z.object({
  userCosmeticId: z.string().uuid(),
  characterId: z.string().uuid().nullable(),
});
export const raffleBuyRequest = z.object({ count: z.number().int().min(1).max(1000) });
export const marketListRequest = z.object({
  kind: z.enum(["character", "cosmetic"]),
  refId: z.string().uuid(),
  price: tokenAmount,
});

/* ── admin ────────────────────────────────────────────────────────── */

export const adminPauseRequest = z.object({
  key: z.enum(["withdrawals", "missions", "deposits"]),
  paused: z.boolean(),
});
export const adminFreezeRequest = z.object({
  userId: z.string().uuid(),
  frozen: z.boolean(),
});
export const adminTuneRequest = z.object({
  locationSlug: z.string(),
  patch: z.record(z.unknown()),
});

/** v1.1 (specs/01): tier threshold change — ALWAYS behind 7-day public notice. */
export const adminTierRequest = z.object({
  tier: credTier,
  minBalance: tokenAmount,
  /** Optional explicit effective time; rejected when sooner than the notice window. */
  effectiveAt: z.string().datetime().optional(),
});

/** v1.1 (specs/02): mission insurance, optionally paid with a pass voucher. */
export const insuranceRequest = z.object({ useVoucher: z.boolean().optional() });

/** v1.1 (specs/02): pass reward claim. */
export const passClaimRequest = z.object({ rewardId: z.string().uuid() });

/* ── queries ──────────────────────────────────────────────────────── */

export const leaderboardQuery = z.object({
  board: z.enum(["earners", "hounds", "heists", "most_wanted"]).default("earners"),
});
