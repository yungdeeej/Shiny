import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SEASON1, upgradeCost } from "@trash-wars/economy";
import { toBaseUnits } from "@trash-wars/shared";
import { characters, locations, pendingChanges } from "@trash-wars/db";
import { eq } from "../core/orm.js";
import { getKv, setKv } from "../core/config.js";
import {
  tickEmissionsTopup,
  tickPdDistribution,
  tickPendingChanges,
} from "../core/scheduler.js";
import {
  buildTestApp,
  guest,
  as,
  ledgerTotal,
  systemBalance,
  userBalance,
} from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp({ BETA_TIME_SCALE: "100000" });
});
afterAll(async () => {
  await app.close();
});

describe("idle accrual", () => {
  it("claims at the location rate, capped at 24 game hours, from emissions", async () => {
    const session = await guest(app, "idle_racc");
    const chars = await app.inject(as(session, { method: "GET", url: "/game/characters" }));
    const charId = chars.json()[0].id;

    const station = await app.inject(
      as(session, {
        method: "POST",
        url: `/game/characters/${charId}/station`,
        payload: { locationSlug: "corner-store" },
      }),
    );
    expect(station.statusCode).toBe(200);

    // 1 real hour ago at scale 100000 → way past the 24-game-hour cap.
    await app.ctx.db
      .update(characters)
      .set({ lastClaimedAt: new Date(Date.now() - 3_600_000) })
      .where(eq(characters.id, charId));

    const before = await userBalance(app, session.userId);
    const claim = await app.inject(
      as(session, { method: "POST", url: `/game/characters/${charId}/claim-idle` }),
    );
    expect(claim.statusCode).toBe(200);
    // corner-store 4/h (S1 v2) * 24h cap (level 1) = 96 SHINY.
    expect(BigInt(claim.json().amount)).toBe(toBaseUnits(96));
    expect((await userBalance(app, session.userId)) - before).toBe(toBaseUnits(96));
    expect(await ledgerTotal(app)).toBe(0n);

    // Unstationed characters can't claim.
    const unstation = await app.inject(
      as(session, {
        method: "POST",
        url: `/game/characters/${charId}/station`,
        payload: { locationSlug: null },
      }),
    );
    expect(unstation.statusCode).toBe(200);
    const denied = await app.inject(
      as(session, { method: "POST", url: `/game/characters/${charId}/claim-idle` }),
    );
    expect(denied.statusCode).toBe(400);
  });
});

describe("upgrades", () => {
  it("prices 500 * 1.35^level, burns the cost, bumps stat + level, caps at 10", async () => {
    const session = await guest(app, "gym_racc");
    const chars = await app.inject(as(session, { method: "GET", url: "/game/characters" }));
    const charId = chars.json()[0].id;

    const burnBefore = await systemBalance(app, "burn_pool");
    const res = await app.inject(
      as(session, {
        method: "POST",
        url: `/game/characters/${charId}/upgrade`,
        payload: { stat: "muscle" },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(BigInt(res.json().cost)).toBe(upgradeCost(1)); // starter muscle is 1 → 675
    expect(res.json().stats.muscle).toBe(2);
    expect(res.json().level).toBe(2);
    expect((await systemBalance(app, "burn_pool")) - burnBefore).toBe(upgradeCost(1));

    await app.ctx.db
      .update(characters)
      .set({ stats: { stealth: 1, muscle: 10, luck: 1, reputation: 0 } })
      .where(eq(characters.id, charId));
    const capped = await app.inject(
      as(session, {
        method: "POST",
        url: `/game/characters/${charId}/upgrade`,
        payload: { stat: "muscle" },
      }),
    );
    expect(capped.statusCode).toBe(409);
    expect(capped.json().error.code).toBe("STAT_CAPPED");
  });
});

describe("daily ticks", () => {
  it("emissions top-up posts the daily budget exactly once per game day", async () => {
    await setKv(app.ctx.db, "emissions_last_topup_day", -1);
    const before = await systemBalance(app, "emissions_budget");
    await tickEmissionsTopup(app.ctx);
    const mid = await systemBalance(app, "emissions_budget");
    expect(mid - before).toBe(SEASON1.dailyBudget);
    await tickEmissionsTopup(app.ctx); // same game day → no-op
    expect(await systemBalance(app, "emissions_budget")).toBe(mid);
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("pd distribution pays 80% pro-rata by 1 + reputation*0.25", async () => {
    const copA = await guest(app, "pd_cop_a");
    const copB = await guest(app, "pd_cop_b");
    const mkHound = (ownerUserId: string, name: string, reputation: number) => ({
      ownerUserId,
      name,
      faction: "bloodhound" as const,
      level: 1,
      stats: { stealth: 0, muscle: 0, luck: 0, reputation },
      dna: name.padEnd(16, "0").slice(0, 16),
      status: "idle" as const,
      inGame: true,
    });
    await app.ctx.db
      .insert(characters)
      .values([mkHound(copA.userId, "Dist Rookie", 0), mkHound(copB.userId, "Dist Vet", 4)]);

    // Fund the pool to a round figure.
    const pool = toBaseUnits(3_000);
    const current = await systemBalance(app, "pd_pool");
    await app.ctx.ledger.postTransaction(
      [
        { accountId: app.ctx.accounts.treasury, delta: -(pool - current) },
        { accountId: app.ctx.accounts.pd_pool, delta: pool - current },
      ],
      { idempotencyKey: "test:pd-fund", refType: "test" },
    );

    await setKv(app.ctx.db, "pd_last_dist_day", -1);
    const aBefore = await userBalance(app, copA.userId);
    const bBefore = await userBalance(app, copB.userId);
    await tickPdDistribution(app.ctx);

    // distributable = 2400; weights 10000 vs 20000 → 800 / 1600.
    expect((await userBalance(app, copA.userId)) - aBefore).toBe(toBaseUnits(800));
    expect((await userBalance(app, copB.userId)) - bBefore).toBe(toBaseUnits(1600));
    expect(await systemBalance(app, "pd_pool")).toBe(toBaseUnits(600)); // 20% buffer
    expect(await ledgerTotal(app)).toBe(0n);

    // Same game day → second tick is a no-op.
    await tickPdDistribution(app.ctx);
    expect((await userBalance(app, copA.userId)) - aBefore).toBe(toBaseUnits(800));
  });
});

describe("admin tuning ratchet", () => {
  it("decreases apply now; increases wait behind the 48h timelock", async () => {
    const admin = await guest(app, "tuner_admin");
    const { users } = await import("@trash-wars/db");
    await app.ctx.db.update(users).set({ role: "admin" }).where(eq(users.id, admin.userId));

    // Decrease idle rate (4/h -> 2/h): immediate.
    const down = await app.inject(
      as(admin, {
        method: "POST",
        url: "/admin/tune",
        payload: { locationSlug: "corner-store", patch: { idleRatePerHour: toBaseUnits(2).toString() } },
      }),
    );
    expect(down.statusCode).toBe(200);
    expect(down.json().applied).toBe(true);
    const loc = await app.ctx.db
      .select()
      .from(locations)
      .where(eq(locations.slug, "corner-store"));
    expect((loc[0]!.config as { idleRatePerHour: string }).idleRatePerHour).toBe(
      toBaseUnits(2).toString(),
    );

    // Increase idle rate: pending for 48h, config untouched.
    const up = await app.inject(
      as(admin, {
        method: "POST",
        url: "/admin/tune",
        payload: { locationSlug: "corner-store", patch: { idleRatePerHour: toBaseUnits(8).toString() } },
      }),
    );
    expect(up.statusCode).toBe(200);
    expect(up.json().applied).toBe(false);
    const still = await app.ctx.db
      .select()
      .from(locations)
      .where(eq(locations.slug, "corner-store"));
    expect((still[0]!.config as { idleRatePerHour: string }).idleRatePerHour).toBe(
      toBaseUnits(2).toString(),
    );

    // After the timelock elapses, the sweep applies it.
    await app.ctx.db
      .update(pendingChanges)
      .set({ effectiveAt: new Date(Date.now() - 1000) })
      .where(eq(pendingChanges.applied, false));
    await tickPendingChanges(app.ctx);
    const after = await app.ctx.db
      .select()
      .from(locations)
      .where(eq(locations.slug, "corner-store"));
    expect((after[0]!.config as { idleRatePerHour: string }).idleRatePerHour).toBe(
      toBaseUnits(8).toString(),
    );
  });

  it("admin routes reject non-admins; pause flag round-trips", async () => {
    const civilian = await guest(app, "civ_racc");
    const denied = await app.inject(
      as(civilian, {
        method: "POST",
        url: "/admin/pause",
        payload: { key: "missions", paused: true },
      }),
    );
    expect(denied.statusCode).toBe(403);

    const admin = await guest(app, "pause_admin");
    const { users } = await import("@trash-wars/db");
    await app.ctx.db.update(users).set({ role: "admin" }).where(eq(users.id, admin.userId));
    const pause = await app.inject(
      as(admin, {
        method: "POST",
        url: "/admin/pause",
        payload: { key: "missions", paused: true },
      }),
    );
    expect(pause.statusCode).toBe(200);
    expect(await getKv(app.ctx.db, "missions_paused")).toBe(true);

    const chars = await app.inject(as(civilian, { method: "GET", url: "/game/characters" }));
    const blocked = await app.inject(
      as(civilian, {
        method: "POST",
        url: "/game/missions",
        payload: {
          locationSlug: "corner-store",
          characterId: chars.json()[0].id,
          stake: toBaseUnits(500).toString(),
        },
      }),
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("MISSIONS_PAUSED");
    await setKv(app.ctx.db, "missions_paused", false);
  });
});

describe("public surface", () => {
  it("serves stats and leaderboards", async () => {
    const stats = await app.inject({ method: "GET", url: "/public/stats" });
    expect(stats.statusCode).toBe(200);
    expect(BigInt(stats.json().circulating)).toBeGreaterThan(0n);
    expect(stats.json().seasonLengthDays).toBe(90);

    for (const board of ["earners", "hounds", "heists", "most_wanted"]) {
      const res = await app.inject({ method: "GET", url: `/leaderboard?board=${board}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().board).toBe(board);
    }

    const burns = await app.inject({ method: "GET", url: "/public/burns" });
    expect(burns.statusCode).toBe(200);
  });

  it("websocket sends the feed backlog on connect and live events from the bus", async () => {
    const ws = await app.injectWS("/ws");
    try {
      // The on-connect backlog can beat the in-process client's open event, so
      // request it explicitly via the sync message (same payload).
      const backlogPromise = new Promise<{ type: string }>((resolve) => {
        ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString())));
      });
      ws.send(JSON.stringify({ type: "sync" }));
      const backlog = await backlogPromise;
      expect(backlog.type).toBe("feed_backlog");

      const live = new Promise<{ type: string; event: { message: string } }>((resolve) => {
        ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString())));
      });
      const { publishFeed } = await import("../core/feed.js");
      await publishFeed(app.ctx, { type: "burn", message: "🔥 test burn event" });
      const received = await live;
      expect(received.type).toBe("feed");
      expect(received.event.message).toBe("🔥 test burn event");
    } finally {
      ws.terminate();
    }
  });
});
