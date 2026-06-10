/**
 * Raffle draws: commit-reveal, deterministic weighted sampling without replacement.
 * Same lazy + swept pattern as missions: any read of a due raffle can trigger the
 * draw, and the scheduler sweeps every 15s.
 */
import { rollFromSeeds } from "@trash-wars/economy";
import { raffles, raffleTickets, userCosmetics } from "@trash-wars/db";
import { and, eq, lte, sql } from "./orm.js";
import type { AppContext } from "./context.js";
import { decryptSecret } from "./crypto.js";
import { createCharacter } from "./characters.js";
import { publishFeed } from "./feed.js";

export const ENC_PREFIX = "enc:";

export interface RaffleEntry {
  userId: string;
  count: number;
}

/**
 * Pure winner computation (exported for the verifier + tests):
 * winner i ← roll = rollFromSeeds(serverSeed, "raffle", `${raffleId}:${i}`) mapped over
 * the remaining ticket count; the drawn ticket is removed (without replacement).
 */
export function computeRaffleWinners(
  serverSeed: string,
  raffleId: string,
  entries: RaffleEntry[],
  winnersCount: number,
): string[] {
  const pool = entries.map((e) => ({ ...e }));
  let total = pool.reduce((s, e) => s + e.count, 0);
  const winners: string[] = [];
  for (let i = 0; i < winnersCount && total > 0; i++) {
    const roll = rollFromSeeds(serverSeed, "raffle", `${raffleId}:${i}`);
    let target = Math.min(total - 1, Math.floor(roll * total));
    for (const entry of pool) {
      if (entry.count <= 0) continue;
      if (target < entry.count) {
        winners.push(entry.userId);
        entry.count -= 1;
        total -= 1;
        break;
      }
      target -= entry.count;
    }
  }
  return winners;
}

/** Add `n` tickets for a user (insert-or-increment). Returns the new total. */
export async function addRaffleTickets(
  ctx: AppContext,
  raffleId: string,
  userId: string,
  n: number,
): Promise<number> {
  const existing = await ctx.db
    .select()
    .from(raffleTickets)
    .where(and(eq(raffleTickets.raffleId, raffleId), eq(raffleTickets.userId, userId)))
    .limit(1);
  if (existing[0]) {
    const updated = await ctx.db
      .update(raffleTickets)
      .set({ count: sql`${raffleTickets.count} + ${n}` })
      .where(eq(raffleTickets.id, existing[0].id))
      .returning({ count: raffleTickets.count });
    return updated[0]!.count;
  }
  const inserted = await ctx.db
    .insert(raffleTickets)
    .values({ raffleId, userId, count: n })
    .returning({ count: raffleTickets.count });
  return inserted[0]!.count;
}

export async function drawRaffle(ctx: AppContext, raffleId: string): Promise<boolean> {
  // Atomic claim — exactly one drawer wins the race.
  const claimed = await ctx.db
    .update(raffles)
    .set({ state: "drawing" })
    .where(and(eq(raffles.id, raffleId), eq(raffles.state, "open")))
    .returning();
  const raffle = claimed[0];
  if (!raffle) return false;

  const stored = raffle.serverSeed ?? "";
  const serverSeed = stored.startsWith(ENC_PREFIX)
    ? decryptSecret(stored.slice(ENC_PREFIX.length), ctx.env.serverSeedEncryptionKey)
    : stored;
  if (!serverSeed) {
    ctx.log.error({ raffleId }, "raffle has no server seed — cannot draw");
    return false;
  }

  // Stable entry order (user id asc) — the verifier replays the same order.
  const tickets = await ctx.db
    .select()
    .from(raffleTickets)
    .where(eq(raffleTickets.raffleId, raffleId))
    .orderBy(raffleTickets.userId);
  const entries: RaffleEntry[] = tickets.map((t) => ({ userId: t.userId, count: t.count }));
  const prize = raffle.prize as { type?: string; faction?: string; itemSlug?: string; winners?: number };
  const winnersCount = Math.max(1, Number(prize.winners ?? 1));
  const winnerIds = computeRaffleWinners(serverSeed, raffleId, entries, winnersCount);

  // Fulfill prizes.
  for (let i = 0; i < winnerIds.length; i++) {
    const userId = winnerIds[i]!;
    try {
      if (raffle.type === "recruitment") {
        await createCharacter(ctx, {
          ownerUserId: userId,
          faction: (prize.faction as "raccoon" | "bloodhound") ?? "raccoon",
          dnaSeed: `raffle:${raffleId}:${userId}:${i}`,
          bonusPoints: 2,
          mintNft: true,
        });
      } else if (prize.itemSlug) {
        await ctx.db.insert(userCosmetics).values({ userId, itemSlug: prize.itemSlug });
      }
      ctx.bus.emitUser(userId, { type: "raffle_won", raffleId, title: raffle.title });
    } catch (err) {
      ctx.log.error({ err, raffleId, userId }, "raffle prize fulfillment failed");
    }
  }

  // Reveal + persist winners (handles resolved lazily by readers via user ids).
  await ctx.db
    .update(raffles)
    .set({ state: "drawn", serverSeed, winners: winnerIds })
    .where(eq(raffles.id, raffleId));

  await publishFeed(ctx, {
    type: "raffle",
    message: `🎟 "${raffle.title}" drew ${winnerIds.length} winner${winnerIds.length === 1 ? "" : "s"} — verify the draw on-site`,
  });
  return true;
}

export async function drawDueRaffles(ctx: AppContext, now = new Date()): Promise<number> {
  const due = await ctx.db
    .select({ id: raffles.id })
    .from(raffles)
    .where(and(eq(raffles.state, "open"), lte(raffles.drawsAt, now)));
  let drawn = 0;
  for (const r of due) {
    try {
      if (await drawRaffle(ctx, r.id)) drawn += 1;
    } catch (err) {
      ctx.log.error({ err, raffleId: r.id }, "raffle draw failed");
    }
  }
  return drawn;
}
