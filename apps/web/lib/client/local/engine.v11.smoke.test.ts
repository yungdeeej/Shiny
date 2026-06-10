/**
 * v1.1 smoke — node-side instantiation of the demo engine exercising:
 *   tier → mission slots, jackpot accrue → win, pass XP → claim.
 * (No localStorage in node: the engine runs purely in memory.)
 */
import { JACKPOT, PASS, applyBps, toBaseUnits } from "@trash-wars/shared";
import { describe, expect, it } from "vitest";
import { GameClientError } from "../types";
import { LocalGameClient } from "./engine";
import type { SaveState, StoredMission } from "./state";

type EngineInternals = {
  state: SaveState;
  resolve(m: StoredMission): void;
};

const internals = (c: LocalGameClient): EngineInternals => c as unknown as EngineInternals;

/** Crafted active mission with a forced outcome table (engine resolves any table). */
function craftedMission(slug: string, outcome: "jackpot" | "rekt_items", stakeWhole: number): StoredMission {
  return {
    id: `smoke-${outcome}-${Math.random().toString(36).slice(2)}`,
    locationSlug: slug,
    characterId: null,
    stake: toBaseUnits(stakeWhole).toString(),
    state: "active",
    serverSeedHash: "smoke",
    clientSeed: "smoke",
    effectiveTable: [{ outcome, probabilityBps: 10_000, multiplierBps: outcome === "jackpot" ? 100_000 : undefined }],
    insurance: false,
    bribed: false,
    startedAt: new Date().toISOString(),
    resolvesAt: new Date().toISOString(),
    serverSeed: "smoke-seed",
  };
}

async function login(): Promise<LocalGameClient> {
  const c = new LocalGameClient();
  await c.guestLogin("Smoke_Tester");
  return c;
}

describe("v1.1 demo engine smoke", () => {
  it("tier gates mission slots: Alley = 1, Block = 2", async () => {
    const c = await login();
    // Alley (default 10k holding): first free-tier job runs, second is rejected
    const m1 = await c.startMission({ locationSlug: "corner-store", stake: toBaseUnits(200).toString() });
    expect(m1.state).toBe("active");
    const chars = await c.getCharacters();
    const starter = chars[0]!;
    await expect(
      c.startMission({ locationSlug: "pawn-shop", characterId: starter.id, stake: toBaseUnits(300).toString() }),
    ).rejects.toMatchObject({ code: "SLOT_LIMIT" });
    // Upgrade to Block (50k) — instant — second concurrent job now allowed
    const me = await c.simulateHolding(toBaseUnits(50_000).toString());
    expect(me.cred?.tier).toBe("block");
    expect(me.cred?.perks.missionSlots).toBe(2);
    const m2 = await c.startMission({
      locationSlug: "pawn-shop",
      characterId: starter.id,
      stake: toBaseUnits(300).toString(),
    });
    expect(m2.state).toBe("active");
    c.destroy();
  });

  it("rejects sub-Alley free-tier and gates the penthouse to Kingpin", async () => {
    const c = await login();
    await c.simulateHolding("0");
    // demo grace keeps the tier for 2 min, but free-tier access reads perks of the
    // effective tier — force the downgrade by expiring the grace window
    internals(c).state.credGraceUntil = new Date(Date.now() - 1000).toISOString();
    await c.getMissions(); // ticks advance()
    const me = await c.getMe();
    expect(me.cred?.tier).toBe("none");
    await expect(
      c.startMission({ locationSlug: "corner-store", stake: toBaseUnits(200).toString() }),
    ).rejects.toMatchObject({ code: "HOLDING_GATE" });
    // penthouse: hidden + rejected below Kingpin
    expect((await c.getLocations()).some((l) => l.slug === "the-penthouse")).toBe(false);
    await c.simulateHolding(toBaseUnits(5_000_000).toString());
    expect((await c.getMe()).cred?.tier).toBe("kingpin");
    expect((await c.getLocations()).some((l) => l.slug === "the-penthouse")).toBe(true);
    c.destroy();
  });

  it("jackpot: seeds 2M, accrues 5% of rekt losses, pays pool − 10% floor on a Mint jackpot after winnable-at", async () => {
    const c = await login();
    const eng = internals(c);
    const seeded = JACKPOT.seedAmount;
    const before = BigInt((await c.getJackpot()).pool);
    expect(before >= seeded).toBe(true); // seed + any bot accrual

    // a rekt loss routes exactly 5% into the pool
    const stake = toBaseUnits(1_000);
    const rekt = craftedMission("jewelry-district", "rekt_items", 1_000);
    eng.state.missions.push(rekt);
    const poolBeforeLoss = BigInt(eng.state.jackpot.pool);
    eng.resolve(rekt);
    const poolAfterLoss = BigInt(eng.state.jackpot.pool);
    expect(poolAfterLoss - poolBeforeLoss).toBe(applyBps(stake, 500));

    // pre-winnable: a Mint jackpot pays the multiplier only
    const early = craftedMission("the-mint", "jackpot", 1_000);
    eng.state.missions.push(early);
    eng.resolve(early);
    expect(early.result?.detail?.jackpotPool).toBeUndefined();
    expect(BigInt(eng.state.jackpot.pool)).toBe(poolAfterLoss);

    // post-winnable: same roll ALSO empties the pool to the 10% floor
    eng.state.jackpot.winnableAt = new Date(Date.now() - 1000).toISOString();
    const win = craftedMission("the-mint", "jackpot", 1_000);
    eng.state.missions.push(win);
    const balBefore = BigInt(eng.state.balance);
    const pool = BigInt(eng.state.jackpot.pool);
    const floor = applyBps(pool, JACKPOT.resetFloorBps);
    eng.resolve(win);
    expect(win.result?.detail?.jackpotPool).toBe((pool - floor).toString());
    expect(BigInt(eng.state.jackpot.pool)).toBe(floor);
    expect(eng.state.jackpot.hits).toBe(1);
    expect(eng.state.jackpot.lastWinner?.handle).toBe("Smoke_Tester");
    // single state update: multiplier payout + pool landed together
    const expectedPayout = (stake * 100_000n) / 10_000n;
    expect(BigInt(eng.state.balance)).toBe(balBefore + expectedPayout + (pool - floor));
    const pub = await c.getJackpot();
    expect(pub.hits).toBe(1);
    expect(pub.winnable).toBe(true);
    c.destroy();
  });

  it("pass: XP accrues from events, premium unlocks retroactively, claims are idempotent, vouchers insure without burn", async () => {
    const c = await login();
    const eng = internals(c);

    // mission XP: first resolution = 20 + 30 daily-first
    const m = craftedMission("jewelry-district", "rekt_items", 1_000);
    eng.state.missions.push(m);
    eng.resolve(m);
    let pass = await c.getPass();
    expect(pass.xp).toBe(PASS.xp.missionResolved + PASS.xp.dailyFirstMission);

    // raffle tickets: 5 XP each, capped at 25/day
    const raffles = await c.getRaffles();
    await c.buyTickets(raffles[0]!.id, 10);
    pass = await c.getPass();
    expect(pass.xp).toBe(50 + PASS.xp.raffleTicketDailyCap);
    expect(pass.level).toBe(0);

    // grind to level 1 via more resolutions
    for (let i = 0; i < 2; i++) {
      const mm = craftedMission("jewelry-district", "rekt_items", 1_000);
      eng.state.missions.push(mm);
      eng.resolve(mm);
    }
    pass = await c.getPass();
    expect(pass.level).toBeGreaterThanOrEqual(1);

    // premium gate → buy (beta rail) → retroactive claim
    const prem1 = pass.rewards.find((r) => r.id === "s1-prem-1")!;
    expect(prem1.claimable).toBe(false);
    await expect(c.claimPassReward("s1-prem-1")).rejects.toMatchObject({ code: "PREMIUM_LOCKED" });
    pass = await c.buyPass();
    expect(pass.premium).toBe(true);
    expect(pass.rewards.find((r) => r.id === "s1-prem-1")?.claimable).toBe(true);

    // iron rule: no reward carries SHINY or stats
    for (const r of pass.rewards) {
      expect(["cosmetic", "insurance_voucher", "raffle_fragments", "nameplate"]).toContain(r.kind);
    }

    // level-1 premium reward is a raffle-fragments drop; claim is idempotent
    const fragsBefore = eng.state.stats.loginFragments;
    pass = await c.claimPassReward("s1-prem-1");
    expect(pass.rewards.find((r) => r.id === "s1-prem-1")?.claimed).toBe(true);
    const fragsAfter = eng.state.stats.loginFragments + (eng.state.stats.freeTicketsClaimed - 0) * 5;
    expect(fragsAfter).toBeGreaterThanOrEqual(fragsBefore);
    const again = await c.claimPassReward("s1-prem-1");
    expect(again.rewards.filter((r) => r.id === "s1-prem-1" && r.claimed).length).toBe(1);

    // voucher: grant via state, insure a rekt-capable job with no burn and no debit
    eng.state.pass.vouchers = 1;
    const chars = await c.getCharacters();
    const job = await c.startMission({
      locationSlug: "jewelry-district",
      characterId: chars[0]!.id,
      stake: toBaseUnits(400).toString(),
    });
    const balBefore = BigInt(eng.state.balance);
    const burnedBefore = eng.state.burnedByPlayer;
    const insured = await c.buyInsurance(job.id, { useVoucher: true });
    expect(insured.insurance).toBe(true);
    expect(eng.state.pass.vouchers).toBe(0);
    expect(BigInt(eng.state.balance)).toBe(balBefore);
    expect(eng.state.burnedByPlayer).toBe(burnedBefore);
    await expect(c.buyInsurance(job.id, { useVoucher: true })).rejects.toBeInstanceOf(GameClientError);
    c.destroy();
  });

  it("tier perks: bail discount and withdrawal fee follow the tier", async () => {
    const c = await login();
    const eng = internals(c);
    await c.simulateHolding(toBaseUnits(250_000).toString()); // District: fee 4%, bail -10%
    const me = await c.getMe();
    expect(me.cred?.perks.withdrawalFeeBps).toBe(400);
    const w = await c.withdraw(toBaseUnits(10_000).toString(), "smoke-dest");
    expect(BigInt(w.fee)).toBe(applyBps(toBaseUnits(10_000), 400));
    // bail: jail the starter and pay the discounted price
    const chars = await c.getCharacters();
    const starter = eng.state.characters.find((x) => x.id === chars[0]!.id)!;
    starter.status = "jailed";
    starter.jailedUntil = new Date(Date.now() + 60_000).toISOString();
    const balBefore = BigInt(eng.state.balance);
    await c.bail(starter.id);
    const paid = balBefore - BigInt(eng.state.balance);
    const base = toBaseUnits(1_500);
    expect(paid).toBe(base - applyBps(base, 1_000));
    c.destroy();
  });
});
