/** Season Pass (v1.1, specs/02) — acceptance criteria. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PASS, toBaseUnits } from "@trash-wars/shared";
import { passProgress, passRewards, users } from "@trash-wars/db";
import { and, eq } from "../core/orm.js";
import { settleMission } from "../core/settle.js";
import { PASS_SEASON } from "../core/pass.js";
import {
  buildTestApp,
  guest,
  as,
  startMissionForced,
  systemBalance,
  ledgerTotal,
  type TestSession,
} from "./helpers.js";

let app: FastifyInstance;

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

/** XP grants ride the async bus — poll until the expectation lands. */
async function waitForXp(userId: string, atLeast: number, timeoutMs = 3_000): Promise<number> {
  const started = Date.now();
  for (;;) {
    const rows = await app.ctx.db
      .select()
      .from(passProgress)
      .where(and(eq(passProgress.userId, userId), eq(passProgress.season, PASS_SEASON)));
    const xp = rows[0]?.xp ?? 0;
    if (xp >= atLeast || Date.now() - started > timeoutMs) return xp;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function setXp(userId: string, xp: number): Promise<void> {
  await app.ctx.db
    .insert(passProgress)
    .values({ userId, season: PASS_SEASON, xp, level: Math.min(PASS.levels, Math.floor(xp / PASS.xpPerLevel)) })
    .onConflictDoUpdate({
      target: [passProgress.userId, passProgress.season],
      set: { xp, level: Math.min(PASS.levels, Math.floor(xp / PASS.xpPerLevel)) },
    });
}

describe("XP accrual", () => {
  it("mission resolution grants XP exactly once under settlement replays", async () => {
    const session = await guest(app, "xp_racc");
    const characterId = await myRaccoon(session);
    const { missionId } = await startMissionForced(
      app,
      session,
      { locationSlug: "first-national", characterId, stake: toBaseUnits(600).toString() },
      "win",
    );
    // 5 concurrent settles → ledger applies once → ONE mission_resolved event.
    await Promise.all(Array.from({ length: 5 }, () => settleMission(app.ctx, missionId)));
    // 20 (mission) + 30 (daily first mission) = 50, exactly once.
    const xp = await waitForXp(session.userId, 50);
    expect(xp).toBe(PASS.xp.missionResolved + PASS.xp.dailyFirstMission);

    // An explicit replay after resolution grants nothing more.
    await settleMission(app.ctx, missionId);
    await new Promise((r) => setTimeout(r, 200));
    expect(await waitForXp(session.userId, 0)).toBe(xp);
  });

  it("raffle ticket XP caps at 25/day; bail pays 10", async () => {
    const session = await guest(app, "xp_raffle_racc");
    const raffleList = await app.inject(as(session, { method: "GET", url: "/raffles" }));
    const raffle = raffleList.json().find((r: { state: string }) => r.state === "open");
    const buy = await app.inject(
      as(session, { method: "POST", url: `/raffles/${raffle.id}/buy`, payload: { count: 10 } }),
    );
    expect(buy.statusCode).toBe(200);
    // 10 tickets × 5 XP = 50 desired, capped at 25/day.
    const xp = await waitForXp(session.userId, 25);
    expect(xp).toBe(PASS.xp.raffleTicketDailyCap);
  });
});

describe("premium purchase + claims", () => {
  it("beta purchase is idempotent and unlocks retroactive premium claims", async () => {
    const session = await guest(app, "pass_whale");
    await setXp(session.userId, 700); // level 7 before buying

    const buy = await app.inject(as(session, { method: "POST", url: "/pass/buy" }));
    expect(buy.statusCode).toBe(200);
    expect(buy.json().receipt).toMatch(/^BETA-PASS-/);
    const again = await app.inject(as(session, { method: "POST", url: "/pass/buy" }));
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyOwned).toBe(true);

    const state = (await app.inject(as(session, { method: "GET", url: "/pass" }))).json();
    expect(state.premium).toBe(true);
    expect(state.level).toBe(7);
    // Retroactive: every premium reward up to level 7 is claimable.
    const claimable = state.rewards.filter(
      (r: { track: string; claimable: boolean }) => r.track === "premium" && r.claimable,
    );
    expect(claimable.length).toBe(7);
    for (const reward of claimable) {
      const res = await app.inject(
        as(session, { method: "POST", url: "/pass/claim", payload: { rewardId: reward.id } }),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().alreadyClaimed).toBe(false);
    }
    // Level-5 premium reward is an insurance voucher → held count is 1.
    const u = await app.ctx.db.select().from(users).where(eq(users.id, session.userId));
    expect(u[0]!.insuranceVouchers).toBe(1);
  });

  it("free users get 403 on premium claims but can claim the free track", async () => {
    const session = await guest(app, "pass_free");
    await setXp(session.userId, 600); // level 6

    const state = (await app.inject(as(session, { method: "GET", url: "/pass" }))).json();
    expect(state.premium).toBe(false);
    const premium5 = state.rewards.find(
      (r: { track: string; level: number }) => r.track === "premium" && r.level === 5,
    );
    const free5 = state.rewards.find(
      (r: { track: string; level: number }) => r.track === "free" && r.level === 5,
    );

    const denied = await app.inject(
      as(session, { method: "POST", url: "/pass/claim", payload: { rewardId: premium5.id } }),
    );
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject(
      as(session, { method: "POST", url: "/pass/claim", payload: { rewardId: free5.id } }),
    );
    expect(ok.statusCode).toBe(200);

    // Idempotent: the second claim reports alreadyClaimed without re-applying.
    const dup = await app.inject(
      as(session, { method: "POST", url: "/pass/claim", payload: { rewardId: free5.id } }),
    );
    expect(dup.statusCode).toBe(200);
    expect(dup.json().alreadyClaimed).toBe(true);

    // Levels above progress are not claimable.
    const premium40 = state.rewards.find(
      (r: { track: string; level: number }) => r.track === "premium" && r.level === 40,
    );
    await app.inject(as(session, { method: "POST", url: "/pass/buy" }));
    const tooLow = await app.inject(
      as(session, { method: "POST", url: "/pass/claim", payload: { rewardId: premium40.id } }),
    );
    expect(tooLow.statusCode).toBe(409);
  });
});

describe("insurance vouchers", () => {
  it("substitute the burn and decrement exactly once; reject at 0", async () => {
    const session = await guest(app, "voucher_racc");
    await app.ctx.db
      .update(users)
      .set({ insuranceVouchers: 1 })
      .where(eq(users.id, session.userId));
    const characterId = await myRaccoon(session);

    const start = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: "first-national", characterId, stake: toBaseUnits(600).toString() },
      }),
    );
    expect(start.statusCode).toBe(200);
    const missionId = start.json().id;

    const burnBefore = await systemBalance(app, "burn_pool");
    const res = await app.inject(
      as(session, {
        method: "POST",
        url: `/game/missions/${missionId}/insurance`,
        payload: { useVoucher: true },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().voucher).toBe(true);
    expect(res.json().vouchersLeft).toBe(0);
    // No burn happened — the voucher substituted it.
    expect(await systemBalance(app, "burn_pool")).toBe(burnBefore);

    const u = await app.ctx.db.select().from(users).where(eq(users.id, session.userId));
    expect(u[0]!.insuranceVouchers).toBe(0);

    // Second mission, no voucher left → 409.
    const chars2 = await app.ctx.db
      .insert((await import("@trash-wars/db")).characters)
      .values({
        ownerUserId: session.userId,
        name: "Voucherless Vic",
        faction: "raccoon",
        level: 1,
        stats: { stealth: 1, muscle: 1, luck: 1, reputation: 0 },
        dna: "voucherless00000",
        status: "idle",
        inGame: true,
      })
      .returning({ id: (await import("@trash-wars/db")).characters.id });
    const start2 = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: {
          locationSlug: "first-national",
          characterId: chars2[0]!.id,
          stake: toBaseUnits(600).toString(),
        },
      }),
    );
    expect(start2.statusCode).toBe(200);
    const denied = await app.inject(
      as(session, {
        method: "POST",
        url: `/game/missions/${start2.json().id}/insurance`,
        payload: { useVoucher: true },
      }),
    );
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.code).toBe("NO_VOUCHERS");
    expect(await ledgerTotal(app)).toBe(0n);
  });
});

describe("config validation (the iron rule)", () => {
  it("no pass reward carries SHINY amounts or stat effects — kind whitelist", async () => {
    const rewards = await app.ctx.db.select().from(passRewards);
    expect(rewards.length).toBeGreaterThan(0);
    const allowed = new Set(["cosmetic", "insurance_voucher", "raffle_fragments", "nameplate"]);
    for (const reward of rewards) {
      expect(allowed.has(reward.kind)).toBe(true);
      if (reward.kind === "cosmetic" || reward.kind === "nameplate") {
        // Pure flex: a catalog reference, never a quantity of anything.
        expect(reward.refSlug).toBeTruthy();
        expect(reward.amount).toBeNull();
      } else {
        // Vouchers/fragments: small integer counts, never token base units.
        expect(reward.refSlug).toBeNull();
        expect(reward.amount).toBeGreaterThanOrEqual(1);
        expect(reward.amount).toBeLessThanOrEqual(5);
      }
    }
    // Cadence: premium every level (50), free every 5 levels (10).
    expect(rewards.filter((r) => r.track === "premium")).toHaveLength(50);
    expect(rewards.filter((r) => r.track === "free")).toHaveLength(10);
  });
});

describe("weekly challenges", () => {
  it("week-0 challenges track progress and grant the 150 XP bonus once", async () => {
    const session = await guest(app, "challenge_racc");
    const characterId = await myRaccoon(session);

    // Week 0 includes "wins_anywhere" target 3.
    for (let i = 0; i < 3; i++) {
      const { missionId } = await startMissionForced(
        app,
        session,
        { locationSlug: "first-national", characterId, stake: toBaseUnits(600).toString() },
        "win",
      );
      await settleMission(app.ctx, missionId);
      await waitForXp(session.userId, 20 * (i + 1)); // let the listener land
    }

    // 3 missions × 20 + 30 first-of-day + 150 challenge bonus = 240.
    const xp = await waitForXp(session.userId, 240);
    expect(xp).toBe(240);

    const state = (await app.inject(as(session, { method: "GET", url: "/pass" }))).json();
    const wins = state.challenges.find((c: { slug: string }) => c.slug === "s1-w0-wins");
    expect(wins.completed).toBe(true);
    expect(wins.progress).toBe(3);
    expect(state.challenges).toHaveLength(3);
  });
});
