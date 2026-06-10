import { describe, expect, it } from "vitest";
import { toBaseUnits, type CharacterStats, type ProbabilityTable } from "@trash-wars/shared";
import { SEASON1_LOCATIONS } from "./config/season1.js";
import { makeRng } from "./rng.js";
import {
  applyBribe,
  applyPatrolModifiers,
  applyStatModifiers,
  computeEvBps,
  computePayout,
  computePayoutEvBps,
  heatBandForWeight,
  idleRatePerHour,
  insurancePrice,
  resolveMission,
  splitBail,
  splitLoss,
  upgradeCost,
} from "./resolve.js";

const sum = (t: ProbabilityTable): number => t.reduce((s, r) => s + r.probabilityBps, 0);
const loc = (slug: string) => {
  const found = SEASON1_LOCATIONS.find((l) => l.slug === slug);
  if (!found) throw new Error(`missing location ${slug}`);
  return found;
};

describe("table modifiers (property-style)", () => {
  it("keeps every table at exactly 10000 bps across 1000 randomized stat/patrol/bribe cases", () => {
    const rng = makeRng("property-tables");
    for (let i = 0; i < 1_000; i++) {
      const location = SEASON1_LOCATIONS[Math.floor(rng() * SEASON1_LOCATIONS.length)];
      if (!location) throw new Error("bad index");
      const stats: CharacterStats = {
        stealth: Math.floor(rng() * 13),
        muscle: Math.floor(rng() * 13),
        luck: Math.floor(rng() * 13),
        reputation: Math.floor(rng() * 13),
      };
      const weight = rng() * 15;

      const patrolled = applyPatrolModifiers(location.table, weight, location);
      const statted = applyStatModifiers(patrolled, stats);
      const base = applyStatModifiers(location.table, stats);
      const bribed = applyBribe(statted, base);

      for (const table of [patrolled, statted, bribed]) {
        expect(sum(table)).toBe(10_000);
        for (const row of table) {
          expect(row.probabilityBps).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(row.probabilityBps)).toBe(true);
        }
      }
      // paying rows never squeezed below 100 bps by patrol pressure
      for (const row of patrolled) {
        if (row.outcome === "win" || row.outcome === "jackpot") {
          expect(row.probabilityBps).toBeGreaterThanOrEqual(100);
        }
      }
    }
  });

  it("stealth lowers arrest and moves it into nothing", () => {
    const table = applyStatModifiers(loc("pawn-shop").table, { stealth: 4, muscle: 0, luck: 0, reputation: 0 });
    expect(table.find((r) => r.outcome === "arrest")?.probabilityBps).toBe(1_100 - 600);
    expect(table.find((r) => r.outcome === "nothing")?.probabilityBps).toBe(1_800 + 600);
  });

  it("muscle raises multipliers, capped at +20%", () => {
    const t5 = applyStatModifiers(loc("corner-store").table, { stealth: 0, muscle: 5, luck: 0, reputation: 0 });
    expect(t5.find((r) => r.outcome === "win")?.multiplierBps).toBe(14_000 + 1_400);
    const t20 = applyStatModifiers(loc("corner-store").table, { stealth: 0, muscle: 50, luck: 0, reputation: 0 });
    expect(t20.find((r) => r.outcome === "win")?.multiplierBps).toBe(14_000 + 2_800); // capped at 20%
  });

  it("luck moves probability from nothing into the jackpot row when present", () => {
    const mint = applyStatModifiers(loc("the-mint").table, { stealth: 0, muscle: 0, luck: 10, reputation: 0 });
    expect(mint.find((r) => r.outcome === "jackpot")?.probabilityBps).toBe(300 + 300);
    expect(mint.find((r) => r.outcome === "nothing")?.probabilityBps).toBe(2_100 - 300);
    // no jackpot row -> no-op
    const corner = applyStatModifiers(loc("corner-store").table, { stealth: 0, muscle: 0, luck: 10, reputation: 0 });
    expect(sum(corner)).toBe(10_000);
    expect(corner.find((r) => r.outcome === "nothing")?.probabilityBps).toBe(2_500);
  });

  it("patrol adds a confiscation row to tables that lack one", () => {
    const corner = loc("corner-store");
    expect(corner.table.some((r) => r.outcome === "confiscation")).toBe(false);
    const patrolled = applyPatrolModifiers(corner.table, 4, corner);
    const conf = patrolled.find((r) => r.outcome === "confiscation");
    expect(conf?.probabilityBps).toBe(Math.min(Math.floor(4 * 60), corner.capConfShiftBps));
    expect(sum(patrolled)).toBe(10_000);
  });

  it("patrol shifts respect the location caps", () => {
    const pawn = loc("pawn-shop");
    const patrolled = applyPatrolModifiers(pawn.table, 100, pawn);
    expect(patrolled.find((r) => r.outcome === "arrest")?.probabilityBps).toBe(1_100 + pawn.capArrestShiftBps);
    expect(patrolled.find((r) => r.outcome === "confiscation")?.probabilityBps).toBe(600 + pawn.capConfShiftBps);
  });

  it("bribe removes half of the patrol-added arrest/confiscation delta", () => {
    const pawn = loc("pawn-shop");
    const patrolled = applyPatrolModifiers(pawn.table, 5, pawn);
    const bribed = applyBribe(patrolled, pawn.table);
    const addedArrest = (patrolled.find((r) => r.outcome === "arrest")?.probabilityBps ?? 0) - 1_100;
    const addedConf = (patrolled.find((r) => r.outcome === "confiscation")?.probabilityBps ?? 0) - 600;
    expect(bribed.find((r) => r.outcome === "arrest")?.probabilityBps).toBe(
      1_100 + addedArrest - Math.floor(addedArrest / 2),
    );
    expect(bribed.find((r) => r.outcome === "confiscation")?.probabilityBps).toBe(
      600 + addedConf - Math.floor(addedConf / 2),
    );
    expect(sum(bribed)).toBe(10_000);
  });
});

describe("resolveMission", () => {
  it("matches the configured corner-store distribution within 1.5% over 200k rolls", () => {
    const table = loc("corner-store").table;
    const rng = makeRng(20_260_610);
    const counts = new Map<string, number>();
    const total = 200_000;
    for (let i = 0; i < total; i++) {
      const row = resolveMission(table, rng());
      counts.set(row.outcome, (counts.get(row.outcome) ?? 0) + 1);
    }
    for (const row of table) {
      const observedBps = ((counts.get(row.outcome) ?? 0) / total) * 10_000;
      expect(Math.abs(observedBps - row.probabilityBps)).toBeLessThanOrEqual(150);
    }
  });

  it("maps roll edges to the right rows", () => {
    const table = loc("corner-store").table;
    expect(resolveMission(table, 0).outcome).toBe("win");
    expect(resolveMission(table, 0.6999).outcome).toBe("win");
    expect(resolveMission(table, 0.7).outcome).toBe("nothing");
    expect(resolveMission(table, 0.9499).outcome).toBe("nothing");
    expect(resolveMission(table, 0.95).outcome).toBe("arrest");
    expect(resolveMission(table, 0.999999).outcome).toBe("arrest");
    expect(() => resolveMission(table, 1)).toThrow();
    expect(() => resolveMission(table, -0.1)).toThrow();
  });
});

describe("money math", () => {
  it("computePayout follows the outcome contract", () => {
    const stake = toBaseUnits(1_000);
    expect(computePayout(stake, { outcome: "win", probabilityBps: 1, multiplierBps: 14_000 })).toBe(
      toBaseUnits(1_400),
    );
    expect(computePayout(stake, { outcome: "jackpot", probabilityBps: 1, multiplierBps: 120_000 })).toBe(
      toBaseUnits(12_000),
    );
    expect(computePayout(stake, { outcome: "nothing", probabilityBps: 1 })).toBe(stake);
    expect(computePayout(stake, { outcome: "arrest", probabilityBps: 1 })).toBe(stake);
    expect(computePayout(stake, { outcome: "confiscation", probabilityBps: 1 })).toBe(0n);
    expect(computePayout(stake, { outcome: "rekt_items", probabilityBps: 1 })).toBe(0n);
    expect(computePayout(stake, { outcome: "rekt_character", probabilityBps: 1 })).toBe(0n);
  });

  it("computeEvBps matches the hand-computed doc-01 EVs", () => {
    const expected: Record<string, number> = {
      "corner-store": 9_800, // 0.70 * 1.4 — the free-tier anchor, frozen
      "pawn-shop": 9_880, // 0.65 * 1.52 (S1 v2)
      "jewelry-district": 10_088, // 0.52 * 1.94 (S1 v2)
      "armored-truck": 10_290, // 0.42 * 2.45 (S1 v2)
      "first-national": 10_500, // 0.25 * 4.2 (S1 v2, was 5.0x)
      "the-mint": 9_900, // 0.15 * 4.6 + 0.03 * 10 (S1 v2, jackpot was 12x)
      "penthouse-job": 10_320, // 0.48 * 2.15 (v1.1, Kingpin-gated)
    };
    for (const location of SEASON1_LOCATIONS) {
      const ev = computeEvBps(location.table);
      const want = expected[location.slug];
      expect(want).toBeDefined();
      expect(Math.abs(ev - (want ?? 0))).toBeLessThanOrEqual(1);
    }
    // full payout EV (incl. stake returned on nothing/arrest) for the budget model
    expect(computePayoutEvBps(loc("corner-store").table)).toBe(9_800 + 3_000);
  });

  it("upgradeCost starts at 500 SHINY and grows monotonically at ×1.35", () => {
    expect(upgradeCost(0)).toBe(toBaseUnits(500));
    expect(upgradeCost(1)).toBe(toBaseUnits(675));
    expect(upgradeCost(2)).toBe(toBaseUnits(911)); // round(500 * 1.35^2 = 911.25)
    let prev = upgradeCost(0);
    for (let level = 1; level <= 30; level++) {
      const next = upgradeCost(level);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });

  it("idleRatePerHour adds 10% per level above 1, bigint math", () => {
    const corner = loc("corner-store");
    expect(idleRatePerHour(corner, 1)).toBe(toBaseUnits(4));
    expect(idleRatePerHour(corner, 2)).toBe((toBaseUnits(4) * 11n) / 10n);
    expect(idleRatePerHour(corner, 11)).toBe(toBaseUnits(8));
  });

  it("insurance, loss/bail splits conserve every base unit", () => {
    const jewelry = loc("jewelry-district");
    expect(insurancePrice(toBaseUnits(10_000), jewelry)).toBe(toBaseUnits(1_600));
    const odd = 1_000_001n; // indivisible amount
    const loss = splitLoss(odd);
    expect(loss.burn + loss.pd + loss.jackpot).toBe(odd);
    const bail = splitBail(odd);
    expect(bail.burn + bail.pd).toBe(odd);
  });

  it("splitLoss routes 94.5/0.5/5 exactly; indivisible remainders go to burn (v1.1)", () => {
    const round = toBaseUnits(10_000);
    const r = splitLoss(round);
    expect(r.pd).toBe(toBaseUnits(50)); // 0.5%
    expect(r.jackpot).toBe(toBaseUnits(500)); // 5%
    expect(r.burn).toBe(toBaseUnits(9_450)); // 94.5%
    for (const odd of [1n, 7n, 199n, 1_000_001n, 9_999_999_999_999n]) {
      const s = splitLoss(odd);
      expect(s.pd).toBe((odd * 50n) / 10_000n);
      expect(s.jackpot).toBe((odd * 500n) / 10_000n);
      expect(s.burn).toBe(odd - s.pd - s.jackpot);
      expect(s.burn + s.pd + s.jackpot).toBe(odd);
    }
  });

  it("heatBandForWeight follows HEAT_THRESHOLDS", () => {
    expect(heatBandForWeight(0)).toBe("none");
    expect(heatBandForWeight(1)).toBe("low");
    expect(heatBandForWeight(2)).toBe("med");
    expect(heatBandForWeight(5)).toBe("high");
    expect(heatBandForWeight(100)).toBe("blazing");
  });
});
