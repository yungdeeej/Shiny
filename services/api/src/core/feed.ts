/**
 * City feed: persisted feed_events + bus broadcast. Messages are anonymized noir
 * one-liners; amounts are reported only as bands, never exact figures.
 */
import { randomUUID } from "node:crypto";
import { SHINY_UNIT, type FeedEvent } from "@trash-wars/shared";
import { feedEvents } from "@trash-wars/db";
import { desc } from "./orm.js";
import type { AppContext } from "./context.js";

/** "<1K" | "1K–10K" | "10K–50K" | "50K+" — bands in whole SHINY. */
export function amountBand(amount: bigint): string {
  const whole = amount / SHINY_UNIT;
  if (whole < 1_000n) return "<1K";
  if (whole < 10_000n) return "1K–10K";
  if (whole < 50_000n) return "10K–50K";
  return "50K+";
}

export interface FeedInput {
  type: FeedEvent["type"];
  message: string;
  locationSlug?: string;
  actor?: string;
  multiplierBps?: number;
  amountBand?: string;
}

export async function publishFeed(ctx: AppContext, input: FeedInput): Promise<FeedEvent> {
  const event: FeedEvent = {
    id: randomUUID(),
    type: input.type,
    locationSlug: input.locationSlug,
    actor: input.actor,
    multiplierBps: input.multiplierBps,
    amountBand: input.amountBand,
    message: input.message,
    at: new Date().toISOString(),
  };
  await ctx.db.insert(feedEvents).values({
    id: event.id,
    type: event.type,
    locationSlug: event.locationSlug ?? null,
    actor: event.actor ?? null,
    multiplierBps: event.multiplierBps ?? null,
    amountBand: event.amountBand ?? null,
    message: event.message,
  });
  ctx.bus.emitFeed(event);
  return event;
}

export async function recentFeed(ctx: AppContext, limit = 30): Promise<FeedEvent[]> {
  const rows = await ctx.db
    .select()
    .from(feedEvents)
    .orderBy(desc(feedEvents.createdAt))
    .limit(limit);
  return rows
    .map((r) => ({
      id: r.id,
      type: r.type as FeedEvent["type"],
      locationSlug: r.locationSlug ?? undefined,
      actor: r.actor ?? undefined,
      multiplierBps: r.multiplierBps ?? undefined,
      amountBand: r.amountBand ?? undefined,
      message: r.message,
      at: r.createdAt.toISOString(),
    }))
    .reverse();
}
