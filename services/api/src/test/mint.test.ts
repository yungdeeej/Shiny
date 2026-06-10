import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { toBaseUnits } from "@trash-wars/shared";
import { characters, mintEvents, mintOrders } from "@trash-wars/db";
import { count, eq } from "../core/orm.js";
import { buildTestApp, guest, as, ledgerTotal, systemBalance } from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
});

describe("mint waves", () => {
  it("30 concurrent mints on supply 10 fulfill exactly 10", async () => {
    const session = await guest(app, "minter_racc");
    const now = new Date();
    const event = (
      await app.ctx.db
        .insert(mintEvents)
        .values({
          faction: "raccoon",
          price: toBaseUnits(1_000), // cheap so one faucet covers 10 mints
          supply: 10,
          remaining: 10,
          opensAt: now,
          closesAt: new Date(now.getTime() + 86_400_000),
          state: "open",
        })
        .returning()
    )[0]!;

    const burnBefore = await systemBalance(app, "burn_pool");
    const responses = await Promise.all(
      Array.from({ length: 30 }, () =>
        app.inject(
          as(session, { method: "POST", url: "/game/mint", payload: { eventId: event.id } }),
        ),
      ),
    );
    const fulfilled = responses.filter((r) => r.statusCode === 200);
    const soldOut = responses.filter((r) => r.statusCode === 409);
    expect(fulfilled.length).toBe(10);
    expect(soldOut.length).toBe(20);

    const remaining = await app.ctx.db
      .select()
      .from(mintEvents)
      .where(eq(mintEvents.id, event.id));
    expect(remaining[0]!.remaining).toBe(0);

    const orders = await app.ctx.db
      .select({ n: count() })
      .from(mintOrders)
      .where(eq(mintOrders.eventId, event.id));
    expect(orders[0]!.n).toBe(10);

    const minted = await app.ctx.db
      .select({ n: count() })
      .from(characters)
      .where(eq(characters.ownerUserId, session.userId));
    expect(minted[0]!.n).toBe(11); // 10 minted + starter

    // Mint = burn: exactly 10x the price burned, ledger conserved.
    expect((await systemBalance(app, "burn_pool")) - burnBefore).toBe(toBaseUnits(10_000));
    expect(await ledgerTotal(app)).toBe(0n);

    // Each minted character has 2 bonus points and an NFT stub.
    const char = fulfilled[0]!.json().character;
    const total =
      char.stats.stealth + char.stats.muscle + char.stats.luck + char.stats.reputation;
    expect(total).toBe(5); // raccoon base 3 + 2 bonus
    expect(char.nftMint).toMatch(/^BETA-ASSET/);
  });

  it("bloodhound mints block at the 10% population cap", async () => {
    const session = await guest(app, "hound_buyer");
    const mk = (i: number, faction: "raccoon" | "bloodhound") => ({
      ownerUserId: session.userId,
      name: `Filler ${faction} ${i}`,
      faction,
      level: 1,
      stats: { stealth: 1, muscle: 1, luck: 1, reputation: 0 },
      dna: `f${i}`.padEnd(16, "0"),
      status: "idle" as const,
      inGame: true,
    });
    // Push the hound share to ≥10% of living characters: with r living raccoons,
    // h hounds satisfy h*10 >= r + h ⇔ h >= ceil(r/9).
    const living = await app.ctx.db.select({ n: count() }).from(characters);
    const raccoons = living[0]!.n;
    const houndsNeeded = Math.ceil(raccoons / 9);
    await app.ctx.db
      .insert(characters)
      .values(Array.from({ length: houndsNeeded }, (_, i) => mk(100 + i, "bloodhound")));

    const event = (
      await app.ctx.db
        .insert(mintEvents)
        .values({
          faction: "bloodhound",
          price: toBaseUnits(1_000),
          supply: 10,
          remaining: 10,
          opensAt: new Date(),
          closesAt: new Date(Date.now() + 86_400_000),
          state: "open",
        })
        .returning()
    )[0]!;

    const res = await app.inject(
      as(session, { method: "POST", url: "/game/mint", payload: { eventId: event.id } }),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("BLOODHOUND_CAP");

    const listing = await app.inject({ method: "GET", url: "/game/mint-events" });
    const wave = listing.json().find((e: { id: string }) => e.id === event.id);
    expect(wave.blocked).toBe(true);
  });
});
