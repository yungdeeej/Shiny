/**
 * Feed-event consumption: decides which city-feed events are Sentinel-worthy.
 * Decoupled from transport — main.ts polls and calls handleFeedEvent(evt).
 *
 * Filter (docs/12): jackpots >= 5x, character deaths, confiscations > 25k,
 * raffle results, weekly burn completion.
 */
import { z } from "zod";

/**
 * Local mirror of packages/shared feedEvent (kept dependency-free on purpose —
 * sentinel ships with zod only). `amount` is an optional whole-token number
 * some feed payloads include alongside the privacy-banded `amountBand`.
 */
export const feedEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  locationSlug: z.string().optional(),
  actor: z.string().optional(),
  multiplierBps: z.number().optional(),
  amount: z.number().optional(),
  amountBand: z.string().optional(),
  message: z.string(),
  at: z.string(),
});
export type FeedEvent = z.infer<typeof feedEventSchema>;

export type StoryKind =
  | "jackpot"
  | "death"
  | "confiscation"
  | "raffle"
  | "burn"
  | "mint"
  | "faction-war";

export interface StoryEvent {
  kind: StoryKind;
  sourceId: string;
  /** Display name only if the feed exposed one (server already respects feed_anonymous). */
  actor?: string;
  locationSlug?: string;
  multiplierX?: number;
  amount?: number;
  amountBand?: string;
  message: string;
  at: string;
}

const JACKPOT_MIN_X = 5;
const CONFISCATION_MIN = 25_000; // whole SHINY
const BIG_BAND = /(?:[2-9][5-9]?|\d{3,})k\+?|whale|massive/i;

/**
 * Returns a StoryEvent when the feed event qualifies for Sentinel coverage,
 * null otherwise. Pure function — rate limiting and dedupe live in state.ts.
 */
export function handleFeedEvent(raw: unknown): StoryEvent | null {
  const parsed = feedEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  const evt = parsed.data;

  // NOTE on privacy: we only ever use evt.actor as delivered by the public
  // feed — the API omits/aliases actors for users with feed_anonymous set, so
  // the Sentinel never needs to (and cannot) check that flag itself.
  const base = {
    sourceId: evt.id,
    actor: evt.actor,
    locationSlug: evt.locationSlug,
    amount: evt.amount,
    amountBand: evt.amountBand,
    message: evt.message,
    at: evt.at,
  };

  switch (evt.type) {
    case "jackpot": {
      const x = (evt.multiplierBps ?? 0) / 10_000;
      if (x < JACKPOT_MIN_X) return null;
      return { kind: "jackpot", multiplierX: x, ...base };
    }
    case "death":
      return { kind: "death", ...base };
    case "confiscation": {
      const big =
        (evt.amount !== undefined && evt.amount > CONFISCATION_MIN) ||
        (evt.amount === undefined && evt.amountBand !== undefined && BIG_BAND.test(evt.amountBand));
      if (!big) return null;
      return { kind: "confiscation", ...base };
    }
    case "raffle":
      return { kind: "raffle", ...base };
    case "burn":
      return { kind: "burn", ...base };
    case "mint":
      // mint waves are always newsworthy (scarcity events drive the burn)
      return { kind: "mint", ...base };
    case "patrol":
      // a heavy patrol push reads as faction warfare — only the big ones.
      if (evt.amountBand !== undefined && BIG_BAND.test(evt.amountBand)) {
        return { kind: "faction-war", ...base };
      }
      return null;
    default:
      return null;
  }
}
