import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  commitHash,
  resolveMission,
  rollFromSeeds,
  splitLoss,
  insurancePrice,
  SEASON1_LOCATIONS,
} from "@trash-wars/economy";
import { toBaseUnits } from "@trash-wars/shared";
import { characters } from "@trash-wars/db";
import { eq } from "../core/orm.js";
import { settleMission } from "../core/settle.js";
import {
  buildTestApp,
  guest,
  as,
  ledgerTotal,
  systemBalance,
  userBalance,
  startMissionForced,
  forceDue,
  type TestSession,
} from "./helpers.js";

let app: FastifyInstance;

// Scale 1000: a 12h mission lasts 43s (forced due manually), but the 5-min
// insurance cutoff is only 0.3s wide — purchasable right after start.
beforeAll(async () => {
  app = await buildTestApp({ BETA_TIME_SCALE: "1000" });
});
afterAll(async () => {
  await app.close();
});

async function myRaccoon(session: TestSession): Promise<string> {
  const res = await app.inject(as(session, { method: "GET", url: "/game/characters" }));
  return res.json().find((c: { faction: string }) => c.faction === "raccoon").id;
}

const FN = "first-national";
const STAKE = toBaseUnits(2_500); // first-national min stake

describe("mission lifecycle", () => {
  it("win: outcome matches an independent recompute from the revealed seed", async () => {
    const session = await guest(app, "racc_win");
    const characterId = await myRaccoon(session);
    const before = await userBalance(app, session.userId);

    const { missionId, effectiveTable } = await startMissionForced(
      app,
      session,
      { locationSlug: FN, characterId, stake: STAKE.toString() },
      "win",
    );

    // Lazy settlement via read.
    const read = await app.inject(as(session, { method: "GET", url: `/game/missions/${missionId}` }));
    expect(read.statusCode).toBe(200);
    expect(read.json().state).toBe("resolved");
    expect(read.json().outcome.outcome).toBe("win");

    // Independent recompute from the public verifier payload.
    const verify = await app.inject({ method: "GET", url: `/game/missions/${missionId}/verify` });
    expect(verify.statusCode).toBe(200);
    const v = verify.json();
    expect(commitHash(v.serverSeed)).toBe(v.serverSeedHash);
    const roll = rollFromSeeds(v.serverSeed, v.clientSeed, missionId);
    expect(roll).toBeCloseTo(v.roll, 12);
    const row = resolveMission(effectiveTable, roll);
    expect(row.outcome).toBe("win");

    // Payout = stake * multiplier; profit drawn from emissions.
    const payout = (STAKE * BigInt(row.multiplierBps!)) / 10_000n;
    expect(BigInt(read.json().outcome.payout)).toBe(payout);
    expect(await userBalance(app, session.userId)).toBe(before - STAKE + payout);

    // Character back to idle, ledger conserved.
    const char = (await app.inject(as(session, { method: "GET", url: "/game/characters" }))).json()[0];
    expect(char.status).toBe("idle");
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("arrest: stake returned, character jailed, bail releases (75/25 burn/pd)", async () => {
    const session = await guest(app, "racc_arrest");
    const characterId = await myRaccoon(session);
    const before = await userBalance(app, session.userId);

    const { missionId } = await startMissionForced(
      app,
      session,
      { locationSlug: FN, characterId, stake: STAKE.toString() },
      "arrest",
    );
    await settleMission(app.ctx, missionId);

    expect(await userBalance(app, session.userId)).toBe(before); // stake returned
    let char = (await app.inject(as(session, { method: "GET", url: "/game/characters" }))).json()[0];
    expect(char.status).toBe("jailed");
    expect(char.jailedUntil).not.toBeNull();

    const burnBefore = await systemBalance(app, "burn_pool");
    const pdBefore = await systemBalance(app, "pd_pool");
    const bail = await app.inject(
      as(session, { method: "POST", url: `/game/characters/${characterId}/bail` }),
    );
    expect(bail.statusCode).toBe(200);
    char = (await app.inject(as(session, { method: "GET", url: "/game/characters" }))).json()[0];
    expect(char.status).toBe("idle");
    expect((await systemBalance(app, "burn_pool")) - burnBefore).toBe(toBaseUnits(1_125)); // 75%
    expect((await systemBalance(app, "pd_pool")) - pdBefore).toBe(toBaseUnits(375)); // 25%
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("confiscation: stake routes to pd_pool (no patrols active)", async () => {
    const session = await guest(app, "racc_conf");
    const characterId = await myRaccoon(session);
    const pdBefore = await systemBalance(app, "pd_pool");

    const { missionId } = await startMissionForced(
      app,
      session,
      { locationSlug: FN, characterId, stake: STAKE.toString() },
      "confiscation",
    );
    await settleMission(app.ctx, missionId);

    expect((await systemBalance(app, "pd_pool")) - pdBefore).toBe(STAKE);
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("rekt_character without insurance: split loss + character dies", async () => {
    const session = await guest(app, "racc_dead");
    const characterId = await myRaccoon(session);
    const burnBefore = await systemBalance(app, "burn_pool");
    const pdBefore = await systemBalance(app, "pd_pool");

    const { missionId } = await startMissionForced(
      app,
      session,
      { locationSlug: FN, characterId, stake: STAKE.toString() },
      "rekt_character",
    );
    await settleMission(app.ctx, missionId);

    const { burn, pd } = splitLoss(STAKE);
    expect((await systemBalance(app, "burn_pool")) - burnBefore).toBe(burn);
    expect((await systemBalance(app, "pd_pool")) - pdBefore).toBe(pd);
    const char = (await app.inject(as(session, { method: "GET", url: "/game/characters" }))).json()[0];
    expect(char.status).toBe("dead");
    expect(await ledgerTotal(app)).toBe(0n);

    // Dead characters can't run missions.
    const again = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: FN, characterId, stake: STAKE.toString() },
      }),
    );
    expect(again.statusCode).toBe(409);
  });

  it("insurance downgrades rekt_character to rekt_items (character survives)", async () => {
    const session = await guest(app, "racc_insured");
    const characterId = await myRaccoon(session);

    // Start (not yet due), buy insurance, then force the fatal outcome.
    const start = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: FN, characterId, stake: STAKE.toString() },
      }),
    );
    expect(start.statusCode).toBe(200);
    const mission = start.json();

    const burnBefore = await systemBalance(app, "burn_pool");
    const buy = await app.inject(
      as(session, { method: "POST", url: `/game/missions/${mission.id}/insurance` }),
    );
    expect(buy.statusCode).toBe(200);
    const loc = SEASON1_LOCATIONS.find((l) => l.slug === FN)!;
    expect(BigInt(buy.json().price)).toBe(insurancePrice(STAKE, loc));
    expect((await systemBalance(app, "burn_pool")) - burnBefore).toBe(insurancePrice(STAKE, loc));
    const dup = await app.inject(
      as(session, { method: "POST", url: `/game/missions/${mission.id}/insurance` }),
    );
    expect(dup.statusCode).toBe(409);

    const { peekServerSeed, findClientSeed, setClientSeed } = await import("./helpers.js");
    const seed = await peekServerSeed(app, mission.id);
    await setClientSeed(
      app,
      mission.id,
      findClientSeed(seed, mission.id, mission.effectiveTable, "rekt_character"),
    );
    await forceDue(app, mission.id);
    const result = await settleMission(app.ctx, mission.id);
    expect(result!.outcome).toBe("rekt_items");

    const read = await app.inject(as(session, { method: "GET", url: `/game/missions/${mission.id}` }));
    expect(read.json().outcome.detail.insuranceSaved).toBe(true);
    const char = (await app.inject(as(session, { method: "GET", url: "/game/characters" }))).json()[0];
    expect(char.status).toBe("idle"); // survived
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("settles exactly once under 5 concurrent settle calls", async () => {
    const session = await guest(app, "racc_race");
    const characterId = await myRaccoon(session);
    const before = await userBalance(app, session.userId);

    const { missionId, effectiveTable } = await startMissionForced(
      app,
      session,
      { locationSlug: FN, characterId, stake: STAKE.toString() },
      "win",
    );
    const results = await Promise.all(
      Array.from({ length: 5 }, () => settleMission(app.ctx, missionId)),
    );
    const applied = results.filter((r) => r && !r.alreadySettled);
    expect(applied.length).toBe(1);

    const winRow = effectiveTable.find((r: { outcome: string }) => r.outcome === "win")!;
    const payout = (STAKE * BigInt(winRow.multiplierBps!)) / 10_000n;
    expect(await userBalance(app, session.userId)).toBe(before - STAKE + payout); // paid ONCE
    expect(await ledgerTotal(app)).toBe(0n);
  });
});

describe("free-tier missions", () => {
  it("runs without a character, enforces stake cap and cooldown", async () => {
    const session = await guest(app, "free_tier_racc");

    const tooHigh = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: "corner-store", stake: toBaseUnits(6_000).toString() },
      }),
    );
    expect(tooHigh.statusCode).toBe(400);
    expect(tooHigh.json().error.code).toBe("STAKE_TOO_HIGH");

    const ok = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: "corner-store", stake: toBaseUnits(1_000).toString() },
      }),
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.json().characterId).toBeNull();

    // 8h game-hour cooldown (28.8s real at scale 1000) blocks the immediate retry.
    const again = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: "corner-store", stake: toBaseUnits(1_000).toString() },
      }),
    );
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("FREE_TIER_COOLDOWN");

    // Free tier is corner-store only; character-required locations refuse.
    const noChar = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: "pawn-shop", stake: toBaseUnits(500).toString() },
      }),
    );
    expect(noChar.statusCode).toBe(400);
    expect(noChar.json().error.code).toBe("CHARACTER_REQUIRED");
  });
});

describe("mission guards", () => {
  it("locks staked balance and enforces stake bounds", async () => {
    const session = await guest(app, "guard_racc");
    const characterId = await myRaccoon(session);

    const below = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: FN, characterId, stake: toBaseUnits(100).toString() },
      }),
    );
    expect(below.statusCode).toBe(400);

    // Stake 90k of 100k, then a second mission of 20k must fail on unlocked balance.
    const big = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: FN, characterId, stake: toBaseUnits(90_000).toString() },
      }),
    );
    expect(big.statusCode).toBe(200);
    const me = await app.inject(as(session, { method: "GET", url: "/me" }));
    expect(me.json().lockedBalance).toBe(toBaseUnits(90_000).toString());

    // Same character is busy anyway — use the free tier to hit the balance check.
    const broke = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: "corner-store", stake: toBaseUnits(5_000).toString() },
      }),
    );
    expect(broke.statusCode).toBe(400);
    expect(broke.json().error.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("verify 404s while the mission is unresolved (seed stays sealed)", async () => {
    const session = await guest(app, "sealed_racc");
    // Insert an idle raccoon directly (starter is busy in the previous test).
    const rows = await app.ctx.db
      .insert(characters)
      .values({
        ownerUserId: session.userId,
        name: "Sealed Sam",
        faction: "raccoon",
        level: 1,
        stats: { stealth: 1, muscle: 1, luck: 1, reputation: 0 },
        dna: "abcd1234abcd1234",
        status: "idle",
        inGame: true,
      })
      .returning();
    const start = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: FN, characterId: rows[0]!.id, stake: STAKE.toString() },
      }),
    );
    expect(start.statusCode).toBe(200);
    const verify = await app.inject({
      method: "GET",
      url: `/game/missions/${start.json().id}/verify`,
    });
    expect(verify.statusCode).toBe(404);
  });
});
