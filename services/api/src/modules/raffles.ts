/** Raffles module: ticket sales (100% burn), login-fragment conversion, verifiable draws. */
import type { FastifyInstance } from "fastify";
import { PROVABLY_FAIR_ALGORITHM } from "@trash-wars/economy";
import { raffleBuyRequest, type Raffle } from "@trash-wars/shared";
import { loginFragments, raffleTickets, raffles, users } from "@trash-wars/db";
import { and, count, eq, inArray, sql } from "../core/orm.js";
import { conflict, insufficientFunds, notFound } from "../core/errors.js";
import { getCounter, addToCounter } from "../core/config.js";
import { getUserAccount, unlockedBalance } from "../core/accounts.js";
import { drawRaffle } from "../core/raffles.js";
import { requireTos } from "./session.js";

type RaffleRow = typeof raffles.$inferSelect;

function liveState(r: RaffleRow, now = new Date()): Raffle["state"] {
  if (r.state === "drawn" || r.state === "drawing") return r.state;
  if (now < r.opensAt) return "upcoming";
  return "open";
}

export default async function rafflesModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  async function ticketsSold(raffleId: string): Promise<number> {
    const rows = await ctx.db
      .select({ v: sql<string>`coalesce(sum(${raffleTickets.count}), 0)::text` })
      .from(raffleTickets)
      .where(eq(raffleTickets.raffleId, raffleId));
    return Number(rows[0]?.v ?? "0");
  }

  async function addTickets(raffleId: string, userId: string, n: number): Promise<number> {
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

  /**
   * Login fragments → tickets, converted lazily on /raffles reads (cheapest
   * implementation; noted in docs): every 5 unconsumed daily-login fragments
   * become one ticket in the earliest open raffle.
   */
  async function convertFragments(userId: string): Promise<void> {
    const fragRows = await ctx.db
      .select({ n: count() })
      .from(loginFragments)
      .where(eq(loginFragments.userId, userId));
    // v1.1 (specs/02): Season Pass raffle_fragments rewards add to the same pool.
    const bonus = await getCounter(ctx.db, `pass_fragments:${userId}`);
    const total = BigInt(fragRows[0]?.n ?? 0) + bonus;
    const used = await getCounter(ctx.db, `fragments_used:${userId}`);
    const available = total - used;
    if (available < 5n) return;
    const open = await ctx.db
      .select()
      .from(raffles)
      .where(eq(raffles.state, "open"))
      .orderBy(raffles.drawsAt)
      .limit(1);
    const raffle = open[0];
    if (!raffle || raffle.drawsAt <= new Date()) return;
    const tickets = Number(available / 5n);
    await addTickets(raffle.id, userId, tickets);
    await addToCounter(ctx.db, `fragments_used:${userId}`, BigInt(tickets) * 5n);
  }

  async function raffleToApi(r: RaffleRow, userId?: string): Promise<Raffle> {
    const sold = await ticketsSold(r.id);
    let myTickets: number | undefined;
    if (userId) {
      const mine = await ctx.db
        .select({ count: raffleTickets.count })
        .from(raffleTickets)
        .where(and(eq(raffleTickets.raffleId, r.id), eq(raffleTickets.userId, userId)))
        .limit(1);
      myTickets = mine[0]?.count ?? 0;
    }
    let winnerHandles: string[] | null = null;
    if (r.state === "drawn" && Array.isArray(r.winners)) {
      const ids = r.winners.map(String);
      if (ids.length > 0) {
        const rows = await ctx.db
          .select({ id: users.id, handle: users.handle })
          .from(users)
          .where(inArray(users.id, ids));
        const byId = new Map(rows.map((u) => [u.id, u.handle]));
        winnerHandles = ids.map((id) => byId.get(id) ?? "unknown");
      } else {
        winnerHandles = [];
      }
    }
    return {
      id: r.id,
      type: r.type,
      title: r.title,
      prize: r.prize,
      ticketPrice: r.ticketPrice.toString(),
      ticketsSold: sold,
      maxTickets: r.maxTickets,
      myTickets,
      opensAt: r.opensAt.toISOString(),
      drawsAt: r.drawsAt.toISOString(),
      state: liveState(r),
      serverSeedHash: r.serverSeedHash,
      winners: winnerHandles,
    };
  }

  app.get("/raffles", async (request) => {
    const userId = request.user?.id;
    if (userId) await convertFragments(userId);
    // Lazy draw of anything due.
    const due = await ctx.db
      .select({ id: raffles.id })
      .from(raffles)
      .where(and(eq(raffles.state, "open"), sql`${raffles.drawsAt} <= now()`));
    for (const r of due) await drawRaffle(ctx, r.id);

    const rows = await ctx.db.select().from(raffles).orderBy(raffles.drawsAt);
    const result = [];
    for (const r of rows) result.push(await raffleToApi(r, userId));
    return result;
  });

  app.post<{ Params: { id: string } }>("/raffles/:id/buy", async (request) => {
    const user = requireTos(request);
    const { count: buyCount } = raffleBuyRequest.parse(request.body);
    const rows = await ctx.db
      .select()
      .from(raffles)
      .where(eq(raffles.id, request.params.id))
      .limit(1);
    const raffle = rows[0];
    if (!raffle) throw notFound("raffle not found");
    if (liveState(raffle) !== "open" || raffle.drawsAt <= new Date()) {
      throw conflict("RAFFLE_CLOSED", "raffle is not open for tickets");
    }
    const sold = await ticketsSold(raffle.id);
    if (raffle.maxTickets !== null && sold + buyCount > raffle.maxTickets) {
      throw conflict("SOLD_OUT", "not enough tickets remaining");
    }

    const price = raffle.ticketPrice * BigInt(buyCount);
    const balances = await unlockedBalance(ctx.db, ctx.ledger, user.id);
    if (balances.unlocked < price) throw insufficientFunds();

    const newTotal = await addTickets(raffle.id, user.id, buyCount);
    const account = await getUserAccount(ctx.ledger, user.id);
    await ctx.ledger.postTransaction(
      [
        { accountId: account, delta: -price },
        { accountId: ctx.accounts.burn_pool, delta: price },
      ],
      {
        idempotencyKey: `raffle:${raffle.id}:${user.id}:${newTotal}`,
        refType: "raffle",
        refId: raffle.id,
      },
    );
    // v1.1 (specs/02): pass XP event (5 XP/ticket, capped 25/day in the listener).
    ctx.bus.emitUser(user.id, {
      type: "raffle_tickets_bought",
      raffleId: raffle.id,
      count: buyCount,
    });
    return { ok: true, myTickets: newTotal };
  });

  app.get<{ Params: { id: string } }>("/raffles/:id/verify", async (request) => {
    const rows = await ctx.db
      .select()
      .from(raffles)
      .where(eq(raffles.id, request.params.id))
      .limit(1);
    const raffle = rows[0];
    if (!raffle) throw notFound("raffle not found");
    if (raffle.state !== "drawn") throw notFound("raffle not drawn yet — seed stays sealed");

    const tickets = await ctx.db
      .select({ userId: raffleTickets.userId, count: raffleTickets.count })
      .from(raffleTickets)
      .where(eq(raffleTickets.raffleId, raffle.id))
      .orderBy(raffleTickets.userId);
    return {
      raffleId: raffle.id,
      serverSeedHash: raffle.serverSeedHash,
      serverSeed: raffle.serverSeed,
      algorithm:
        "winner i: roll = rollFromSeeds(serverSeed, 'raffle', `${raffleId}:${i}`); " +
        "ticket index = floor(roll * remainingTickets) over entries ordered as returned; " +
        "drawn tickets are removed (without replacement). Base roll derivation: " +
        PROVABLY_FAIR_ALGORITHM,
      entries: tickets,
      winners: raffle.winners,
    };
  });
}
