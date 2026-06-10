/** Street Cred holder tiers (v1.1, specs/01) — acceptance criteria. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { toBaseUnits } from "@trash-wars/shared";
import { characters, mintEvents, pendingChanges, raffleTickets, raffles, tierDefinitions } from "@trash-wars/db";
import { and, eq } from "../core/orm.js";
import { resolveTier, invalidateTierCache, credInfoFor } from "../core/tiers.js";
import { tickPendingChanges, tickWeeklyRaffleGrants } from "../core/scheduler.js";
import {
  buildTestApp,
  guest,
  as,
  setHolding,
  systemBalance,
  ledgerTotal,
  type TestSession,
} from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp({ BETA_TIME_SCALE: "100000" });
});
afterAll(async () => {
  await app.close();
});

const DEST = "BetaDestinationAddress11111111111111111111";

/** Insert an extra idle raccoon directly (the guest starter may be busy). */
async function addRaccoon(session: TestSession, name: string): Promise<string> {
  const rows = await app.ctx.db
    .insert(characters)
    .values({
      ownerUserId: session.userId,
      name,
      faction: "raccoon",
      level: 1,
      stats: { stealth: 1, muscle: 1, luck: 1, reputation: 0 },
      dna: name.padEnd(16, "0").slice(0, 16),
      status: "idle",
      inGame: true,
    })
    .returning({ id: characters.id });
  return rows[0]!.id;
}

function startMission(session: TestSession, characterId: string) {
  return app.inject(
    as(session, {
      method: "POST",
      url: "/game/missions",
      payload: {
        locationSlug: "first-national",
        characterId,
        stake: toBaseUnits(600).toString(),
      },
    }),
  );
}

describe("mission slots = f(tier)", () => {
  it("Alley (10k held) cannot run 2 concurrent missions", async () => {
    const session = await guest(app, "alley_racc");
    setHolding(app, session, toBaseUnits(10_000));
    const charA = await addRaccoon(session, "Alley A");
    const charB = await addRaccoon(session, "Alley B");

    expect((await startMission(session, charA)).statusCode).toBe(200);
    const second = await startMission(session, charB);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("NO_MISSION_SLOTS");
  });

  it("Block (50k held) runs exactly 2; the 3rd is rejected", async () => {
    const session = await guest(app, "block_racc");
    setHolding(app, session, toBaseUnits(50_000));
    const charA = await addRaccoon(session, "Block A");
    const charB = await addRaccoon(session, "Block B");
    const charC = await addRaccoon(session, "Block C");

    expect((await startMission(session, charA)).statusCode).toBe(200);
    expect((await startMission(session, charB)).statusCode).toBe(200);
    const third = await startMission(session, charC);
    expect(third.statusCode).toBe(409);
    expect(third.json().error.code).toBe("NO_MISSION_SLOTS");
  });
});

describe("withdrawal fee = f(tier)", () => {
  it("District pays exactly 4.00% (bigint boundary)", async () => {
    const session = await guest(app, "district_racc");
    setHolding(app, session, toBaseUnits(250_000));

    // Indivisible amount: 10,000 SHINY + 1 base unit → fee floors to exactly 400 SHINY.
    const amount = toBaseUnits(10_000) + 1n;
    const treasuryBefore = await systemBalance(app, "treasury");
    const res = await app.inject(
      as(session, {
        method: "POST",
        url: "/bank/withdraw",
        payload: { amount: amount.toString(), destAddress: DEST },
      }),
    );
    expect(res.statusCode).toBe(200);
    const fee = (amount * 400n) / 10_000n;
    expect(fee).toBe(toBaseUnits(400)); // exact 4.00% floor
    expect(BigInt(res.json().fee)).toBe(fee);
    expect((await systemBalance(app, "treasury")) - treasuryBefore).toBe(fee);
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("Kingpin pays 2%, none-tier pays the 5% base", async () => {
    const kingpin = await guest(app, "kingpin_racc");
    setHolding(app, kingpin, toBaseUnits(5_000_000));
    const res = await app.inject(
      as(kingpin, {
        method: "POST",
        url: "/bank/withdraw",
        payload: { amount: toBaseUnits(10_000).toString(), destAddress: DEST },
      }),
    );
    expect(BigInt(res.json().fee)).toBe(toBaseUnits(200));

    const pleb = await guest(app, "none_racc");
    setHolding(app, pleb, 0n);
    const res2 = await app.inject(
      as(pleb, {
        method: "POST",
        url: "/bank/withdraw",
        payload: { amount: toBaseUnits(10_000).toString(), destAddress: DEST },
      }),
    );
    expect(BigInt(res2.json().fee)).toBe(toBaseUnits(500));
  });
});

describe("free tier is the Alley gate", () => {
  it("sub-Alley holding is rejected; Alley passes", async () => {
    const session = await guest(app, "subloft_racc");
    setHolding(app, session, toBaseUnits(9_999));
    const denied = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: "corner-store", stake: toBaseUnits(500).toString() },
      }),
    );
    expect(denied.statusCode).toBe(400);
    expect(denied.json().error.code).toBe("HOLDING_TOO_LOW");

    setHolding(app, session, toBaseUnits(10_000));
    const ok = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: "corner-store", stake: toBaseUnits(500).toString() },
      }),
    );
    expect(ok.statusCode).toBe(200);
  });
});

describe("penthouse-job (Kingpin location)", () => {
  it("Borough is rejected; Kingpin can start", async () => {
    const borough = await guest(app, "borough_racc");
    setHolding(app, borough, toBaseUnits(1_000_000));
    const char = await addRaccoon(borough, "Borough Bandit");
    const denied = await app.inject(
      as(borough, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: "penthouse-job", characterId: char, stake: toBaseUnits(800).toString() },
      }),
    );
    expect(denied.statusCode).toBe(403);

    const kingpin = await guest(app, "kingpin_racc2");
    setHolding(app, kingpin, toBaseUnits(5_000_000));
    const kChar = await addRaccoon(kingpin, "Kingpin Klaw");
    const ok = await app.inject(
      as(kingpin, {
        method: "POST",
        url: "/game/missions",
        payload: { locationSlug: "penthouse-job", characterId: kChar, stake: toBaseUnits(800).toString() },
      }),
    );
    expect(ok.statusCode).toBe(200);
  });
});

describe("downgrade grace (anti-flicker)", () => {
  it("upgrades apply immediately; downgrades wait 24 game-hours", async () => {
    const session = await guest(app, "grace_racc");
    setHolding(app, session, toBaseUnits(250_000));
    let resolved = await resolveTier(app.ctx, session.userId, { force: true });
    expect(resolved.tier).toBe("district"); // immediate upgrade
    expect(resolved.graceUntil).toBeNull();

    // Balance drops below the District threshold → tier holds, grace starts.
    setHolding(app, session, toBaseUnits(50_000));
    resolved = await resolveTier(app.ctx, session.userId, { force: true });
    expect(resolved.tier).toBe("district");
    expect(resolved.graceUntil).not.toBeNull();

    // Re-qualifying cancels the pending downgrade.
    setHolding(app, session, toBaseUnits(250_000));
    resolved = await resolveTier(app.ctx, session.userId, { force: true });
    expect(resolved.tier).toBe("district");
    expect(resolved.graceUntil).toBeNull();

    // Drop again and let the grace elapse (24 game-hours = 864ms at scale 100000).
    setHolding(app, session, toBaseUnits(50_000));
    await resolveTier(app.ctx, session.userId, { force: true });
    await new Promise((r) => setTimeout(r, 950));
    resolved = await resolveTier(app.ctx, session.userId, { force: true });
    expect(resolved.tier).toBe("block");
    expect(resolved.graceUntil).toBeNull();
  });
});

describe("GET /me cred", () => {
  it("includes tier, shortfall to the next tier and perks", async () => {
    const session = await guest(app, "me_cred_racc");
    setHolding(app, session, toBaseUnits(60_000));
    const me = await app.inject(as(session, { method: "GET", url: "/me" }));
    expect(me.statusCode).toBe(200);
    const cred = me.json().cred;
    expect(cred.tier).toBe("block");
    expect(cred.nextTier).toBe("district");
    expect(BigInt(cred.shortfall)).toBe(toBaseUnits(190_000));
    expect(cred.perks.missionSlots).toBe(2);
    expect(cred.perks.withdrawalFeeBps).toBe(500);
  });
});

describe("Borough weekly raffle ticket", () => {
  it("grants exactly one ticket per ISO week (idempotent tick)", async () => {
    const session = await guest(app, "weekly_racc");
    setHolding(app, session, toBaseUnits(1_000_000));
    await resolveTier(app.ctx, session.userId, { force: true }); // persist current_tier

    const open = await app.ctx.db
      .select()
      .from(raffles)
      .where(eq(raffles.state, "open"))
      .limit(1);
    const raffle = open[0]!;

    await tickWeeklyRaffleGrants(app.ctx);
    await tickWeeklyRaffleGrants(app.ctx); // idempotent — same ISO week

    const tickets = await app.ctx.db
      .select()
      .from(raffleTickets)
      .where(and(eq(raffleTickets.raffleId, raffle.id), eq(raffleTickets.userId, session.userId)));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.count).toBe(1);
  });
});

describe("tier threshold timelock", () => {
  async function admin(handle: string): Promise<TestSession> {
    const session = await guest(app, handle);
    const { users } = await import("@trash-wars/db");
    await app.ctx.db.update(users).set({ role: "admin" }).where(eq(users.id, session.userId));
    return session;
  }

  it("rejects a change without the 7-day notice", async () => {
    const adm = await admin("tier_admin");
    const res = await app.inject(
      as(adm, {
        method: "POST",
        url: "/admin/tiers",
        payload: {
          tier: "block",
          minBalance: toBaseUnits(75_000).toString(),
          effectiveAt: new Date(Date.now() + 3_600_000).toISOString(), // only 1h notice
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("NOTICE_REQUIRED");
  });

  it("queues with 7-day notice and applies via the ratchet sweep", async () => {
    const adm = await admin("tier_admin2");
    const res = await app.inject(
      as(adm, {
        method: "POST",
        url: "/admin/tiers",
        payload: { tier: "block", minBalance: toBaseUnits(75_000).toString() },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().applied).toBe(false);

    // Threshold unchanged until the sweep runs after effectiveAt.
    let def = await app.ctx.db
      .select()
      .from(tierDefinitions)
      .where(eq(tierDefinitions.tier, "block"));
    expect(def[0]!.minBalance).toBe(toBaseUnits(50_000));

    await app.ctx.db
      .update(pendingChanges)
      .set({ effectiveAt: new Date(Date.now() - 1000) })
      .where(eq(pendingChanges.key, "tier:block"));
    await tickPendingChanges(app.ctx);

    def = await app.ctx.db.select().from(tierDefinitions).where(eq(tierDefinitions.tier, "block"));
    expect(def[0]!.minBalance).toBe(toBaseUnits(75_000));

    // Resolution honors the new threshold: 60k held is now only Alley.
    const session = await guest(app, "post_change_racc");
    setHolding(app, session, toBaseUnits(60_000));
    const resolved = await resolveTier(app.ctx, session.userId, { force: true });
    expect(resolved.tier).toBe("alley");
    const info = await credInfoFor(app.ctx, session.userId);
    expect(info.nextTier).toBe("block");
    expect(BigInt(info.shortfall!)).toBe(toBaseUnits(15_000));

    // Restore for any later assertions in this file.
    await app.ctx.db
      .update(tierDefinitions)
      .set({ minBalance: toBaseUnits(50_000) })
      .where(eq(tierDefinitions.tier, "block"));
    invalidateTierCache();
  });
});

describe("mint early access (District+)", () => {
  it("District mints during the early hour; Block is rejected until public open", async () => {
    // Scale 1 app: 1 game-hour = 1 real hour, so "opens in 1 minute" sits
    // squarely inside District's 1h early window and outside Block's none.
    const slowApp = await buildTestApp({ BETA_TIME_SCALE: "1" });
    try {
      const event = (
        await slowApp.ctx.db
          .insert(mintEvents)
          .values({
            faction: "raccoon",
            price: toBaseUnits(1_000),
            supply: 10,
            remaining: 10,
            opensAt: new Date(Date.now() + 60_000),
            closesAt: new Date(Date.now() + 86_400_000),
            state: "upcoming",
          })
          .returning()
      )[0]!;

      const block = await guest(slowApp, "mint_block");
      setHolding(slowApp, block, toBaseUnits(50_000));
      const denied = await slowApp.inject(
        as(block, { method: "POST", url: "/game/mint", payload: { eventId: event.id } }),
      );
      expect(denied.statusCode).toBe(409);
      expect(denied.json().error.code).toBe("MINT_NOT_OPEN");

      const district = await guest(slowApp, "mint_district");
      setHolding(slowApp, district, toBaseUnits(250_000));
      const ok = await slowApp.inject(
        as(district, { method: "POST", url: "/game/mint", payload: { eventId: event.id } }),
      );
      expect(ok.statusCode).toBe(200);
      expect(ok.json().character.faction).toBe("raccoon");
    } finally {
      await slowApp.close();
    }
  });
});
