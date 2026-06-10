import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { applyBps, toBaseUnits, type ProbabilityTable } from "@trash-wars/shared";
import { SEASON1_LOCATIONS } from "@trash-wars/economy";
import { characters, patrols } from "@trash-wars/db";
import { eq } from "../core/orm.js";
import { settleMission } from "../core/settle.js";
import { tickPatrolShifts } from "../core/scheduler.js";
import {
  buildTestApp,
  guest,
  as,
  ledgerTotal,
  userBalance,
  startMissionForced,
  type TestSession,
} from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp({ BETA_TIME_SCALE: "1000" });
});
afterAll(async () => {
  await app.close();
});

function bps(table: ProbabilityTable, outcome: string): number {
  return table.find((r) => r.outcome === outcome)?.probabilityBps ?? 0;
}
function tableSum(table: ProbabilityTable): number {
  return table.reduce((s, r) => s + r.probabilityBps, 0);
}

async function makeHound(session: TestSession, name: string, reputation: number): Promise<string> {
  const rows = await app.ctx.db
    .insert(characters)
    .values({
      ownerUserId: session.userId,
      name,
      faction: "bloodhound",
      level: 1,
      stats: { stealth: 0, muscle: 0, luck: 0, reputation },
      dna: name.padEnd(16, "0").slice(0, 16),
      status: "idle",
      inGame: true,
    })
    .returning();
  return rows[0]!.id;
}

const PAWN = "pawn-shop"; // cap 5, base arrest 1200, conf 500

describe("patrols", () => {
  it("shifts the persisted mission table (sum stays 10000) and pays bounty on confiscation", async () => {
    const cop = await guest(app, "officer_rex");
    const houndId = await makeHound(cop, "K9 Rex", 5); // weight 1 + 5*0.2 = 2

    const patrolRes = await app.inject(
      as(cop, {
        method: "POST",
        url: "/pvp/patrols",
        payload: { characterId: houndId, locationSlug: PAWN },
      }),
    );
    expect(patrolRes.statusCode).toBe(200);
    expect(patrolRes.json().weight).toBe(2);

    const base = SEASON1_LOCATIONS.find((l) => l.slug === PAWN)!.table;
    const racc = await guest(app, "patrolled_racc");
    const chars = await app.inject(as(racc, { method: "GET", url: "/game/characters" }));
    const stake = toBaseUnits(1_000);

    const start = await app.inject(
      as(racc, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: PAWN, characterId: chars.json()[0].id, stake: stake.toString() },
      }),
    );
    expect(start.statusCode).toBe(200);
    const table: ProbabilityTable = start.json().effectiveTable;
    expect(tableSum(table)).toBe(10_000);
    // weight 2 → arrest +160bps, conf +120bps (starter raccoon stealth 1: −150 arrest)
    expect(bps(table, "arrest")).toBe(bps(base, "arrest") - 150 + 160);
    expect(bps(table, "confiscation")).toBe(bps(base, "confiscation") + 120);

    // Force confiscation: 40% of the stake to the patrolling hound's owner.
    const { peekServerSeed, findClientSeed, setClientSeed, forceDue } = await import("./helpers.js");
    const seed = await peekServerSeed(app, start.json().id);
    await setClientSeed(
      app,
      start.json().id,
      findClientSeed(seed, start.json().id, table, "confiscation"),
    );
    await forceDue(app, start.json().id);

    const copBefore = await userBalance(app, cop.userId);
    await settleMission(app.ctx, start.json().id);
    expect((await userBalance(app, cop.userId)) - copBefore).toBe(applyBps(stake, 4_000));
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("rejects patrols past the aggregate weight cap", async () => {
    const cop = await guest(app, "officer_cap");
    // pawn-shop cap is 5; 2.0 already on shift from the previous test.
    const heavy1 = await makeHound(cop, "Heavy One", 5); // 2.0 → total 4.0
    const heavy2 = await makeHound(cop, "Heavy Two", 10); // 3.0 → would be 7.0 > 5

    const ok = await app.inject(
      as(cop, {
        method: "POST",
        url: "/pvp/patrols",
        payload: { characterId: heavy1, locationSlug: PAWN },
      }),
    );
    expect(ok.statusCode).toBe(200);

    const over = await app.inject(
      as(cop, {
        method: "POST",
        url: "/pvp/patrols",
        payload: { characterId: heavy2, locationSlug: PAWN },
      }),
    );
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe("PATROL_FULL");

    // The rejected hound stays idle and its patrol row is gone.
    const char = await app.ctx.db
      .select()
      .from(characters)
      .where(eq(characters.id, heavy2));
    expect(char[0]!.status).toBe("idle");
  });

  it("only raccoons mission, only bloodhounds patrol", async () => {
    const cop = await guest(app, "officer_role");
    const houndId = await makeHound(cop, "Role Hound", 0);
    const res = await app.inject(
      as(cop, {
        method: "POST",
        url: "/game/missions",
        payload: {
          locationSlug: PAWN,
          characterId: houndId,
          stake: toBaseUnits(500).toString(),
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("WRONG_FACTION");

    const chars = await app.inject(as(cop, { method: "GET", url: "/game/characters" }));
    const raccoon = chars.json().find((c: { faction: string }) => c.faction === "raccoon");
    const patrol = await app.inject(
      as(cop, {
        method: "POST",
        url: "/pvp/patrols",
        payload: { characterId: raccoon.id, locationSlug: PAWN },
      }),
    );
    expect(patrol.statusCode).toBe(400);
  });

  it("bribe halves the patrol delta exactly once and pays the shift 25%", async () => {
    const cop = await guest(app, "officer_bribed");
    const houndId = await makeHound(cop, "Greasy Palm", 5); // weight 2
    const JD = "jewelry-district"; // cap 6 — patrol fresh location for clean math
    const patrolRes = await app.inject(
      as(cop, {
        method: "POST",
        url: "/pvp/patrols",
        payload: { characterId: houndId, locationSlug: JD },
      }),
    );
    expect(patrolRes.statusCode).toBe(200);

    const racc = await guest(app, "briber_racc");
    const chars = await app.inject(as(racc, { method: "GET", url: "/game/characters" }));
    const stake = toBaseUnits(10_000);
    const start = await app.inject(
      as(racc, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: JD, characterId: chars.json()[0].id, stake: stake.toString() },
      }),
    );
    expect(start.statusCode).toBe(200);
    const before: ProbabilityTable = start.json().effectiveTable;
    const base = SEASON1_LOCATIONS.find((l) => l.slug === JD)!.table;
    const baseArrest = bps(base, "arrest") - 150; // starter stealth 1
    const arrestDelta = bps(before, "arrest") - baseArrest;
    const confDelta = bps(before, "confiscation") - bps(base, "confiscation");
    expect(arrestDelta).toBe(160);
    expect(confDelta).toBe(120);

    const copBefore = await userBalance(app, cop.userId);
    const bribe = await app.inject(
      as(racc, { method: "POST", url: `/game/missions/${start.json().id}/bribe` }),
    );
    expect(bribe.statusCode).toBe(200);
    const price = applyBps(stake, 300);
    expect(BigInt(bribe.json().price)).toBe(price);
    // The single patrolling hound owner takes the full 25% cut.
    expect((await userBalance(app, cop.userId)) - copBefore).toBe(applyBps(price, 2_500));

    const after: ProbabilityTable = bribe.json().effectiveTable;
    expect(tableSum(after)).toBe(10_000);
    expect(bps(after, "arrest")).toBe(bps(before, "arrest") - Math.floor(arrestDelta / 2));
    expect(bps(after, "confiscation")).toBe(bps(before, "confiscation") - Math.floor(confDelta / 2));

    const again = await app.inject(
      as(racc, { method: "POST", url: `/game/missions/${start.json().id}/bribe` }),
    );
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("ALREADY_BRIBED");
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("shift end reverts the hound to idle via the tick", async () => {
    const cop = await guest(app, "officer_tired");
    const houndId = await makeHound(cop, "Tired Hound", 0);
    const res = await app.inject(
      as(cop, {
        method: "POST",
        url: "/pvp/patrols",
        payload: { characterId: houndId, locationSlug: "armored-truck" },
      }),
    );
    expect(res.statusCode).toBe(200);

    await app.ctx.db
      .update(patrols)
      .set({ shiftEnd: new Date(Date.now() - 1000) })
      .where(eq(patrols.characterId, houndId));
    await tickPatrolShifts(app.ctx);

    const char = await app.ctx.db.select().from(characters).where(eq(characters.id, houndId));
    expect(char[0]!.status).toBe("idle");
  });
});
