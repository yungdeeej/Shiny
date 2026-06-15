/** Mint module: character mint waves (mint = burn), bloodhound population cap. */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Queue, type ConnectionOptions } from "bullmq";
import { POLICY, mintRequest, type MintEvent } from "@trash-wars/shared";
import { characters, mintEvents, mintOrders } from "@trash-wars/db";
import { and, eq, gt, ne, sql } from "../core/orm.js";
import { conflict, insufficientFunds, notFound } from "../core/errors.js";
import { getUserAccount, unlockedBalance } from "../core/accounts.js";
import { createCharacter, characterToApi } from "../core/characters.js";
import { publishFeed, amountBand } from "../core/feed.js";
import { resolveTier } from "../core/tiers.js";
import { complianceGate, requireNotFrozen, requireTos } from "./session.js";

const MINT_QUEUE = "mint-character";

/** Lazily-built BullMQ queue for enqueuing on-chain mint fulfillment (non-beta). */
function bullConnection(redisUrl: string): ConnectionOptions {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: Number(u.pathname.replace("/", "") || 0),
    maxRetriesPerRequest: null,
  };
}

type MintEventRow = typeof mintEvents.$inferSelect;

function liveState(e: MintEventRow, now = new Date()): MintEvent["state"] {
  if (e.state === "closed") return "closed";
  if (now < e.opensAt) return "upcoming";
  if (e.remaining <= 0) return "soldout";
  if (now > e.closesAt) return "closed";
  return "open";
}

async function bloodhoundCapReached(ctx: FastifyInstance["ctx"]): Promise<boolean> {
  const rows = await ctx.db
    .select({
      living: sql<string>`count(*)::text`,
      hounds: sql<string>`count(*) filter (where ${characters.faction} = 'bloodhound')::text`,
    })
    .from(characters)
    .where(ne(characters.status, "dead"));
  const living = Number(rows[0]?.living ?? "0");
  const hounds = Number(rows[0]?.hounds ?? "0");
  if (living === 0) return false;
  return hounds * 10_000 >= living * POLICY.bloodhoundCapBps;
}

export default async function mintModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  // Non-beta with Redis: enqueue on-chain mint fulfillment to the worker. Built
  // once and closed on app shutdown. Beta never touches Redis.
  const useQueue = !ctx.env.beta && Boolean(ctx.env.redisUrl);
  const mintQueue = useQueue ? new Queue(MINT_QUEUE, { connection: bullConnection(ctx.env.redisUrl!) }) : null;
  if (mintQueue) {
    app.addHook("onClose", async () => {
      await mintQueue.close();
    });
  }

  app.get("/game/mint-events", async () => {
    const rows = await ctx.db.select().from(mintEvents);
    const capReached = await bloodhoundCapReached(ctx);
    return rows.map((e) => ({
      id: e.id,
      faction: e.faction,
      price: e.price.toString(),
      supply: e.supply,
      remaining: e.remaining,
      opensAt: e.opensAt.toISOString(),
      closesAt: e.closesAt.toISOString(),
      state: liveState(e),
      /** Bloodhound waves report blocked while hounds >= 10% of living characters. */
      blocked: e.faction === "bloodhound" && capReached,
    }));
  });

  app.post("/game/mint", async (request) => {
    const user = requireNotFrozen(requireTos(request));
    await complianceGate(ctx, request, "play");
    const { eventId } = mintRequest.parse(request.body);

    const rows = await ctx.db.select().from(mintEvents).where(eq(mintEvents.id, eventId)).limit(1);
    const event = rows[0];
    if (!event) throw notFound("mint event not found");
    const state = liveState(event);
    if (state === "upcoming") {
      // v1.1 (specs/01): District+ mint from opensAt − mintEarlyAccessHours
      // (game-hours); everyone else waits for the public open.
      const cred = await resolveTier(ctx, user.id);
      const earlyMs = ctx.clock.gameHoursToMs(cred.perks.mintEarlyAccessHours);
      const inEarlyWindow =
        cred.perks.mintEarlyAccessHours > 0 &&
        Date.now() >= event.opensAt.getTime() - earlyMs;
      if (!inEarlyWindow || event.remaining <= 0) {
        throw conflict("MINT_NOT_OPEN", "mint event is upcoming");
      }
    } else if (state !== "open") {
      throw conflict("MINT_NOT_OPEN", `mint event is ${state}`);
    }
    if (event.faction === "bloodhound" && (await bloodhoundCapReached(ctx))) {
      throw conflict("BLOODHOUND_CAP", "bloodhounds are capped at 10% of living characters");
    }
    const balances = await unlockedBalance(ctx.db, ctx.ledger, user.id);
    if (balances.unlocked < event.price) throw insufficientFunds();

    // Atomic supply decrement — the race arbiter for concurrent mints.
    const claimed = await ctx.db
      .update(mintEvents)
      .set({ remaining: sql`${mintEvents.remaining} - 1` })
      .where(and(eq(mintEvents.id, eventId), gt(mintEvents.remaining, 0)))
      .returning({ remaining: mintEvents.remaining });
    if (!claimed[0]) throw conflict("SOLD_OUT", "mint wave sold out");

    const orderId = randomUUID();
    await ctx.db.insert(mintOrders).values({
      id: orderId,
      userId: user.id,
      eventId,
      state: "pending",
      idempotencyKey: `mint:${orderId}`,
    });

    // Mint = burn: the price is destroyed, the character is the receipt.
    const account = await getUserAccount(ctx.ledger, user.id);
    await ctx.ledger.postTransaction(
      [
        { accountId: account, delta: -event.price },
        { accountId: ctx.accounts.burn_pool, delta: event.price },
      ],
      { idempotencyKey: `mint:${orderId}`, refType: "mint", refId: orderId },
    );

    // Beta (or no Redis): inline stub mint, character gets its asset id instantly
    // and the order is fulfilled in-band (unchanged behavior — all mint tests).
    // Non-beta + Redis: create the character WITHOUT a chain call and enqueue the
    // worker to mint on-chain; the order stays `pending` until the worker fulfills.
    const character = await createCharacter(ctx, {
      ownerUserId: user.id,
      faction: event.faction,
      dnaSeed: orderId,
      bonusPoints: 2,
      mintNft: !mintQueue,
    });

    if (mintQueue) {
      await ctx.db
        .update(mintOrders)
        .set({ characterId: character.id })
        .where(eq(mintOrders.id, orderId));
      await mintQueue.add(
        "fulfill",
        { orderId },
        { jobId: `mint:${orderId}`, attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 100 },
      );
    } else {
      await ctx.db
        .update(mintOrders)
        .set({ state: "fulfilled", characterId: character.id })
        .where(eq(mintOrders.id, orderId));
    }

    await publishFeed(ctx, {
      type: "mint",
      amountBand: amountBand(event.price),
      message:
        event.faction === "bloodhound"
          ? `🐕 a new badge hit the streets — ${character.name} joined the PD`
          : `🦝 fresh paws in town — ${character.name} crawled out of the sewers`,
    });

    return {
      ok: true,
      orderId,
      character: characterToApi(character),
      fulfilling: Boolean(mintQueue),
    };
  });
}
