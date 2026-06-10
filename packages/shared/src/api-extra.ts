/**
 * Additional request/query schemas for the Trash Wars backend (services/api).
 * Added alongside api.ts — never modifies existing contracts, only extends them.
 */
import { z } from "zod";
import { tokenAmount } from "./amounts.js";
import { statKey } from "./game.js";

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

/* ── queries ──────────────────────────────────────────────────────── */

export const leaderboardQuery = z.object({
  board: z.enum(["earners", "hounds", "heists", "most_wanted"]).default("earners"),
});
