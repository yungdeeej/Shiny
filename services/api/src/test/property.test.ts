import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeRng, splitLoss } from "@trash-wars/economy";
import { JACKPOT } from "@trash-wars/shared";
import { missionOutcomes, missions } from "@trash-wars/db";
import { count, eq, inArray, sql } from "../core/orm.js";
import { settleDueMissions, settleMission } from "../core/settle.js";
import {
  buildTestApp,
  guest,
  as,
  forceDue,
  ledgerTotal,
  systemBalance,
  type TestSession,
} from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp({ BETA_TIME_SCALE: "100000" });
});
afterAll(async () => {
  await app.close();
});

// Survivable locations only (no rekt_character) so the same characters can grind
// all rounds; jail is handled with bail.
const LOCATIONS = [
  { slug: "corner-store", min: 100n, max: 500n },
  { slug: "pawn-shop", min: 250n, max: 750n },
  { slug: "jewelry-district", min: 400n, max: 900n },
] as const;
const UNIT = 1_000_000n;

describe("property: 300 random missions conserve the ledger exactly", () => {
  it("total = 0, escrow drains, every mission settles exactly once", { timeout: 180_000 }, async () => {
    const rng = makeRng("property-test-seed");
    const players: { session: TestSession; characterId: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const session = await guest(app, `prop_racc_${i}`);
      const chars = await app.inject(as(session, { method: "GET", url: "/game/characters" }));
      players.push({ session, characterId: chars.json()[0].id });
    }

    const missionIds: string[] = [];
    const ROUNDS = 75; // 4 players x 75 rounds = 300 missions
    for (let round = 0; round < ROUNDS; round++) {
      for (const player of players) {
        // Free any jailed character first.
        const charRes = await app.inject(
          as(player.session, { method: "GET", url: "/game/characters" }),
        );
        const char = charRes.json()[0];
        if (char.status === "jailed") {
          const bail = await app.inject(
            as(player.session, {
              method: "POST",
              url: `/game/characters/${player.characterId}/bail`,
            }),
          );
          expect(bail.statusCode).toBe(200);
        }

        const me = await app.inject(as(player.session, { method: "GET", url: "/me" }));
        const balance = BigInt(me.json().balance) - BigInt(me.json().lockedBalance);
        const loc = LOCATIONS[Math.floor(rng() * LOCATIONS.length)]!;
        const lo = loc.min * UNIT;
        const hi = (loc.max * UNIT < balance / 4n ? loc.max * UNIT : balance / 4n);
        if (hi < lo) continue; // too broke for this location this round
        const span = Number((hi - lo) / UNIT);
        const stake = lo + BigInt(Math.floor(rng() * (span + 1))) * UNIT;

        const res = await app.inject(
          as(player.session, {
            method: "POST",
            url: "/game/missions",
            payload: { locationSlug: loc.slug, characterId: player.characterId, stake: stake.toString() },
          }),
        );
        expect(res.statusCode).toBe(200);
        missionIds.push(res.json().id);
        await forceDue(app, res.json().id);
      }
      await settleDueMissions(app.ctx);

      if (round % 15 === 0) {
        expect(await ledgerTotal(app)).toBe(0n);
      }
    }

    expect(missionIds.length).toBeGreaterThanOrEqual(280);

    // Hammer one mission with 5 concurrent settles on top of everything.
    const target = missionIds[missionIds.length - 1]!;
    await Promise.all(Array.from({ length: 5 }, () => settleMission(app.ctx, target)));

    // Invariants.
    expect(await ledgerTotal(app)).toBe(0n);
    expect(await systemBalance(app, "mission_escrow")).toBe(0n);

    // v1.1 jackpot_pool conservation: with no patrols active, the pool is the
    // 2M seed plus EXACTLY the 5% splitLoss slice of every lost stake.
    const lossRows = await app.ctx.db
      .select({ stake: missions.stake })
      .from(missionOutcomes)
      .innerJoin(missions, eq(missions.id, missionOutcomes.missionId))
      .where(inArray(missionOutcomes.outcome, ["confiscation", "rekt_items", "rekt_character"]));
    let expectedPool = JACKPOT.seedAmount;
    for (const row of lossRows) expectedPool += splitLoss(row.stake).jackpot;
    expect(lossRows.length).toBeGreaterThan(0);
    expect(await systemBalance(app, "jackpot_pool")).toBe(expectedPool);

    const settledRows = await app.ctx.db.select({ n: count() }).from(missionOutcomes);
    const missionRows = await app.ctx.db
      .select({ n: count() })
      .from(missions)
      .where(eq(missions.state, "resolved"));
    // mission_outcomes PK = mission_id: row counts matching proves exactly-once.
    expect(settledRows[0]!.n).toBe(missionIds.length);
    expect(missionRows[0]!.n).toBe(missionIds.length);
  });
});
