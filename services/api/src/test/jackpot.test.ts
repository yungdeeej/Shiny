/** Progressive Jackpot (v1.1, specs/03) — acceptance criteria. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { splitLoss } from "@trash-wars/economy";
import { JACKPOT, applyBps, toBaseUnits } from "@trash-wars/shared";
import { jackpotEvents } from "@trash-wars/db";
import { count, eq } from "../core/orm.js";
import { bootstrap } from "../core/bootstrap.js";
import { setKv } from "../core/config.js";
import { settleMission } from "../core/settle.js";
import {
  buildTestApp,
  guest,
  as,
  ledgerTotal,
  startMissionForced,
  systemBalance,
  userBalance,
  type TestSession,
} from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp({ BETA_TIME_SCALE: "100000" });
});
afterAll(async () => {
  await app.close();
});

async function myRaccoon(session: TestSession): Promise<string> {
  const res = await app.inject(as(session, { method: "GET", url: "/game/characters" }));
  return res.json().find((c: { faction: string }) => c.faction === "raccoon").id;
}

describe("seed", () => {
  it("posts the 2M seed exactly once across two bootstraps", async () => {
    const before = await systemBalance(app, "jackpot_pool");
    await bootstrap(app.ctx); // second boot — idempotency key jackpot-seed:s1
    expect(await systemBalance(app, "jackpot_pool")).toBe(before);

    const seeds = await app.ctx.db
      .select({ n: count() })
      .from(jackpotEvents)
      .where(eq(jackpotEvents.kind, "seed"));
    expect(seeds[0]!.n).toBe(1);
    expect(before).toBeGreaterThanOrEqual(JACKPOT.seedAmount);
    expect(await ledgerTotal(app)).toBe(0n);
  });
});

describe("5% loss routing", () => {
  it("routes losses 94.5/0.5/5 exactly, indivisible remainder to burn", async () => {
    const session = await guest(app, "jp_loser");
    const characterId = await myRaccoon(session);
    // Indivisible stake: 600 SHINY + 1 base unit (within first-national bounds).
    const stake = toBaseUnits(600) + 1n;

    const burnBefore = await systemBalance(app, "burn_pool");
    const pdBefore = await systemBalance(app, "pd_pool");
    const poolBefore = await systemBalance(app, "jackpot_pool");

    const { missionId } = await startMissionForced(
      app,
      session,
      { locationSlug: "first-national", characterId, stake: stake.toString() },
      "confiscation",
    );
    await settleMission(app.ctx, missionId);

    const { burn, pd, jackpot } = splitLoss(stake);
    expect(jackpot).toBe((stake * 500n) / 10_000n);
    expect(pd).toBe((stake * 50n) / 10_000n);
    expect(burn + pd + jackpot).toBe(stake);
    expect((await systemBalance(app, "burn_pool")) - burnBefore).toBe(burn);
    expect((await systemBalance(app, "pd_pool")) - pdBefore).toBe(pd);
    expect((await systemBalance(app, "jackpot_pool")) - poolBefore).toBe(jackpot);
    expect(await ledgerTotal(app)).toBe(0n);
  });
});

describe("jackpot outcome at the-mint", () => {
  const STAKE = toBaseUnits(1_000);

  it("pre-winnable: pays the multiplier only — pool untouched", async () => {
    await setKv(app.ctx.db, "jackpot_winnable_at", new Date(Date.now() + 86_400_000).toISOString());
    const session = await guest(app, "jp_early");
    const characterId = await myRaccoon(session);
    const before = await userBalance(app, session.userId);
    const poolBefore = await systemBalance(app, "jackpot_pool");

    const { missionId, effectiveTable } = await startMissionForced(
      app,
      session,
      { locationSlug: "the-mint", characterId, stake: STAKE.toString() },
      "jackpot",
    );
    await settleMission(app.ctx, missionId);

    const row = effectiveTable.find((r: { outcome: string }) => r.outcome === "jackpot")!;
    const multiplierPayout = (STAKE * BigInt(row.multiplierBps!)) / 10_000n;
    expect(await userBalance(app, session.userId)).toBe(before - STAKE + multiplierPayout);
    expect(await systemBalance(app, "jackpot_pool")).toBe(poolBefore);
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("post-winnable: pays multiplier + (pool − 10% floor); pool resets to the floor; exactly once under concurrent settles", async () => {
    await setKv(app.ctx.db, "jackpot_winnable_at", new Date(Date.now() - 1000).toISOString());
    const session = await guest(app, "jp_winner");
    const characterId = await myRaccoon(session);
    const before = await userBalance(app, session.userId);

    const { missionId, effectiveTable } = await startMissionForced(
      app,
      session,
      { locationSlug: "the-mint", characterId, stake: STAKE.toString() },
      "jackpot",
    );
    const poolBefore = await systemBalance(app, "jackpot_pool");
    const floorHold = applyBps(poolBefore, JACKPOT.resetFloorBps);
    const poolPayout = poolBefore - floorHold;
    expect(poolPayout).toBeGreaterThan(0n);

    // Concurrent settles: exactly one applies, one pool payout.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => settleMission(app.ctx, missionId)),
    );
    expect(results.filter((r) => r && !r.alreadySettled)).toHaveLength(1);

    const row = effectiveTable.find((r: { outcome: string }) => r.outcome === "jackpot")!;
    const multiplierPayout = (STAKE * BigInt(row.multiplierBps!)) / 10_000n;
    expect(await userBalance(app, session.userId)).toBe(
      before - STAKE + multiplierPayout + poolPayout,
    );
    expect(await systemBalance(app, "jackpot_pool")).toBe(floorHold); // at the floor
    expect(await ledgerTotal(app)).toBe(0n);

    // Exactly one win event recorded, with the pool-after audit trail.
    const wins = await app.ctx.db
      .select()
      .from(jackpotEvents)
      .where(eq(jackpotEvents.kind, "win"));
    expect(wins).toHaveLength(1);
    expect(wins[0]!.amount).toBe(poolPayout);
    expect(wins[0]!.poolAfter).toBe(floorHold);
    expect(wins[0]!.userId).toBe(session.userId);
  });

  it("only the-mint is jackpotEligible in the seeded location configs", async () => {
    const { getLocation, listLocations } = await import("../core/locations.js");
    const all = await listLocations(app.ctx);
    expect(all.filter((l) => l.config.jackpotEligible === true).map((l) => l.slug)).toEqual([
      "the-mint",
    ]);
    const mint = await getLocation(app.ctx, "the-mint");
    expect(mint.config.jackpotEligible).toBe(true);
  });
});

describe("GET /public/jackpot", () => {
  it("serves the pool unauthenticated with winner info", async () => {
    const res = await app.inject({ method: "GET", url: "/public/jackpot" });
    expect(res.statusCode).toBe(200);
    const state = res.json();
    expect(BigInt(state.pool)).toBeGreaterThan(0n);
    expect(state.seeded).toBe(JACKPOT.seedAmount.toString());
    expect(state.hits).toBe(1);
    expect(state.lastWinner.handle).toBe("jp_winner");
    expect(state.winnable).toBe(true);
  });
});
