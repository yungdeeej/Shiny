import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { commitHash, generateServerSeed } from "@trash-wars/economy";
import { applyBps, toBaseUnits } from "@trash-wars/shared";
import { characters, raffles, raffleTickets } from "@trash-wars/db";
import { eq } from "../core/orm.js";
import { encryptSecret } from "../core/crypto.js";
import { computeRaffleWinners, ENC_PREFIX } from "../core/raffles.js";
import { tickRaffleDraws } from "../core/scheduler.js";
import {
  buildTestApp,
  guest,
  as,
  ledgerTotal,
  systemBalance,
  userBalance,
  TEST_SEED_KEY,
} from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
});

describe("marketplace", () => {
  it("lists a character and survives a concurrent-buy race: one winner, one charge", async () => {
    const seller = await guest(app, "seller_racc");
    const buyerA = await guest(app, "buyer_a");
    const buyerB = await guest(app, "buyer_b");
    const chars = await app.inject(as(seller, { method: "GET", url: "/game/characters" }));
    const charId = chars.json()[0].id;
    const price = toBaseUnits(10_000);

    const list = await app.inject(
      as(seller, {
        method: "POST",
        url: "/market/list",
        payload: { kind: "character", refId: charId, price: price.toString() },
      }),
    );
    expect(list.statusCode).toBe(200);
    const listingId = list.json().listingId;

    // Listed characters can't run missions.
    const blocked = await app.inject(
      as(seller, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: "pawn-shop", characterId: charId, stake: toBaseUnits(500).toString() },
      }),
    );
    expect(blocked.statusCode).toBe(409);

    const sellerBefore = await userBalance(app, seller.userId);
    const [resA, resB] = await Promise.all([
      app.inject(as(buyerA, { method: "POST", url: `/market/buy/${listingId}` })),
      app.inject(as(buyerB, { method: "POST", url: `/market/buy/${listingId}` })),
    ]);
    const codes = [resA.statusCode, resB.statusCode].sort();
    expect(codes).toEqual([200, 409]);

    const winner = resA.statusCode === 200 ? buyerA : buyerB;
    const loser = resA.statusCode === 200 ? buyerB : buyerA;

    // Fee split: seller 90%, burn 5%, treasury 5%.
    const burnCut = applyBps(price, 500);
    const treasuryCut = applyBps(price, 500);
    expect((await userBalance(app, seller.userId)) - sellerBefore).toBe(
      price - burnCut - treasuryCut,
    );
    expect(await userBalance(app, winner.userId)).toBe(toBaseUnits(100_000) - price);
    expect(await userBalance(app, loser.userId)).toBe(toBaseUnits(100_000)); // not charged

    const owned = await app.ctx.db.select().from(characters).where(eq(characters.id, charId));
    expect(owned[0]!.ownerUserId).toBe(winner.userId);
    expect(owned[0]!.status).toBe("idle");
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("delisting returns the character to idle", async () => {
    const seller = await guest(app, "delist_racc");
    const chars = await app.inject(as(seller, { method: "GET", url: "/game/characters" }));
    const charId = chars.json()[0].id;
    const list = await app.inject(
      as(seller, {
        method: "POST",
        url: "/market/list",
        payload: { kind: "character", refId: charId, price: toBaseUnits(5_000).toString() },
      }),
    );
    const delist = await app.inject(
      as(seller, { method: "POST", url: `/market/delist/${list.json().listingId}` }),
    );
    expect(delist.statusCode).toBe(200);
    const char = await app.ctx.db.select().from(characters).where(eq(characters.id, charId));
    expect(char[0]!.status).toBe("idle");
  });
});

describe("store", () => {
  it("SHINY purchases burn 100% and equip respects slot uniqueness", async () => {
    const session = await guest(app, "fashion_racc");
    const burnBefore = await systemBalance(app, "burn_pool");
    const buy = await app.inject(
      as(session, { method: "POST", url: "/store/buy", payload: { itemSlug: "wet-felt-fedora" } }),
    );
    expect(buy.statusCode).toBe(200);
    expect((await systemBalance(app, "burn_pool")) - burnBefore).toBe(toBaseUnits(500));

    const buy2 = await app.inject(
      as(session, {
        method: "POST",
        url: "/store/buy",
        payload: { itemSlug: "crown-of-shorefront" },
      }),
    );
    expect(buy2.statusCode).toBe(200);

    const chars = await app.inject(as(session, { method: "GET", url: "/game/characters" }));
    const charId = chars.json()[0].id;
    const equip1 = await app.inject(
      as(session, {
        method: "POST",
        url: "/store/equip",
        payload: { userCosmeticId: buy.json().userCosmeticId, characterId: charId },
      }),
    );
    expect(equip1.statusCode).toBe(200);
    // Equipping a second hat replaces the first (slot uniqueness).
    const equip2 = await app.inject(
      as(session, {
        method: "POST",
        url: "/store/equip",
        payload: { userCosmeticId: buy2.json().userCosmeticId, characterId: charId },
      }),
    );
    expect(equip2.statusCode).toBe(200);
    const after = await app.inject(as(session, { method: "GET", url: "/game/characters" }));
    expect(after.json()[0].cosmetics).toEqual(["crown-of-shorefront"]);
  });

  it("SOL-rail items return 501 in beta", async () => {
    const session = await guest(app, "sol_racc");
    const res = await app.inject(
      as(session, {
        method: "POST",
        url: "/store/buy",
        payload: { itemSlug: "shorefront-silk-scarf" },
      }),
    );
    expect(res.statusCode).toBe(501);
  });
});

describe("raffles", () => {
  it("draws deterministically and the verifier replays the exact winners", async () => {
    const serverSeed = generateServerSeed();
    const raffle = (
      await app.ctx.db
        .insert(raffles)
        .values({
          type: "recruitment",
          title: "Test Heat Raffle",
          prize: { type: "character", faction: "raccoon", winners: 2 },
          ticketPrice: toBaseUnits(1_000),
          maxTickets: 1000,
          opensAt: new Date(Date.now() - 1000),
          drawsAt: new Date(Date.now() + 3_600_000),
          serverSeedHash: commitHash(serverSeed),
          serverSeed: ENC_PREFIX + encryptSecret(serverSeed, TEST_SEED_KEY),
          state: "open",
        })
        .returning()
    )[0]!;

    const players = await Promise.all(
      Array.from({ length: 3 }, (_, i) => guest(app, `raffler_${i}`)),
    );
    const counts = [5, 3, 1];
    const burnBefore = await systemBalance(app, "burn_pool");
    for (const [i, player] of players.entries()) {
      const res = await app.inject(
        as(player, {
          method: "POST",
          url: `/raffles/${raffle.id}/buy`,
          payload: { count: counts[i]! },
        }),
      );
      expect(res.statusCode).toBe(200);
    }
    expect((await systemBalance(app, "burn_pool")) - burnBefore).toBe(toBaseUnits(9_000));

    // Force the draw via the sweep tick.
    await app.ctx.db
      .update(raffles)
      .set({ drawsAt: new Date(Date.now() - 1000) })
      .where(eq(raffles.id, raffle.id));
    await tickRaffleDraws(app.ctx);

    const drawn = await app.ctx.db.select().from(raffles).where(eq(raffles.id, raffle.id));
    expect(drawn[0]!.state).toBe("drawn");
    expect(drawn[0]!.serverSeed).toBe(serverSeed); // revealed

    // Independent recompute over the same (userId-ordered) entries.
    const entries = await app.ctx.db
      .select()
      .from(raffleTickets)
      .where(eq(raffleTickets.raffleId, raffle.id))
      .orderBy(raffleTickets.userId);
    const expected = computeRaffleWinners(
      serverSeed,
      raffle.id,
      entries.map((e) => ({ userId: e.userId, count: e.count })),
      2,
    );
    expect(drawn[0]!.winners).toEqual(expected);

    // Recruitment prize: each winner received a fresh character.
    for (const winnerId of expected) {
      const owned = await app.ctx.db
        .select()
        .from(characters)
        .where(eq(characters.ownerUserId, winnerId));
      expect(owned.length).toBeGreaterThanOrEqual(2); // starter + prize (dupes possible)
    }

    // Verifier endpoint exposes seed + entries; hash matches the pre-committed one.
    const verify = await app.inject({ method: "GET", url: `/raffles/${raffle.id}/verify` });
    expect(verify.statusCode).toBe(200);
    expect(commitHash(verify.json().serverSeed)).toBe(drawn[0]!.serverSeedHash);
    expect(await ledgerTotal(app)).toBe(0n);

    // Double-draw is a no-op (state already drawn).
    await tickRaffleDraws(app.ctx);
    const again = await app.ctx.db.select().from(raffles).where(eq(raffles.id, raffle.id));
    expect(again[0]!.winners).toEqual(expected);
  });
});
