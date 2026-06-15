import { z } from "zod";

/* ════════════════════════════════════════════════════════════════════
   SOL payment rail (doc 11 + doc 13 §4): SOL buys flex + convenience.
   The server builds an unsigned SOL transfer to the revenue wallet with a
   unique reference memo; the wallet signs+sends; the server verifies the
   confirmed tx (finalized, exact lamports, correct payer, correct memo)
   before granting — idempotent on the tx signature. NEVER carries $SHINY.
   ════════════════════════════════════════════════════════════════════ */

export const LAMPORTS_PER_SOL = 1_000_000_000;

export const solProductKind = z.enum(["season_pass", "cosmetic"]);
export type SolProductKind = z.infer<typeof solProductKind>;

/** Request a payable: what the player wants to buy on the SOL rail. */
export const solBuyRequest = z.object({
  product: solProductKind,
  /** cosmetic slug, or "premium" for the season pass. */
  ref: z.string(),
});
export type SolBuyRequest = z.infer<typeof solBuyRequest>;

/**
 * The unsigned transaction + the binding the server will check on confirm.
 * `serializedTx` is base64 of a VersionedTransaction with no signatures; the
 * client deserializes, has the wallet sign+send, then calls /confirm.
 */
export const solBuyResponse = z.object({
  product: solProductKind,
  ref: z.string(),
  priceSol: z.number(),
  lamports: z.number().int().nonnegative(),
  revenueWallet: z.string(),
  /** Unique per intent; echoed in the tx memo and required on confirm. */
  reference: z.string(),
  memo: z.string(),
  serializedTx: z.string(),
  /** ISO expiry — the built tx's blockhash is only valid for a short window. */
  expiresAt: z.string(),
});
export type SolBuyResponse = z.infer<typeof solBuyResponse>;

export const solConfirmRequest = z.object({
  txSig: z.string().min(32),
  reference: z.string(),
});
export type SolConfirmRequest = z.infer<typeof solConfirmRequest>;

export const solConfirmResponse = z.object({
  granted: z.boolean(),
  product: solProductKind,
  ref: z.string(),
  txSig: z.string(),
  /** True when the same signature was already processed (idempotent replay). */
  alreadyGranted: z.boolean(),
});
export type SolConfirmResponse = z.infer<typeof solConfirmResponse>;
