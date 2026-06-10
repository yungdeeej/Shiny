import { describe, expect, it } from "vitest";
import { z } from "zod";
import { locationConfig, toBaseUnits, type LocationConfig } from "@trash-wars/shared";
import { SEASON1, SEASON1_LOCATIONS, checkSeasonInvariant } from "./season1.js";

describe("SEASON1 config", () => {
  it("has the six S1 locations in escalation order", () => {
    expect(SEASON1_LOCATIONS.map((l) => l.slug)).toEqual([
      "corner-store",
      "pawn-shop",
      "jewelry-district",
      "armored-truck",
      "first-national",
      "the-mint",
    ]);
  });

  it("every probability table sums to exactly 10000 bps", () => {
    for (const loc of SEASON1_LOCATIONS) {
      expect(loc.table.reduce((s, r) => s + r.probabilityBps, 0)).toBe(10_000);
    }
  });

  it("re-validates against the shared zod schema", () => {
    expect(() => z.array(locationConfig).parse(SEASON1_LOCATIONS)).not.toThrow();
  });

  it("season header derives from SUPPLY", () => {
    expect(SEASON1.index).toBe(1);
    expect(SEASON1.days).toBe(90);
    expect(SEASON1.emissions).toBe(toBaseUnits(210_000_000));
    // dailyBudget is bigint floor of emissions/90 — never over-streams the reserve
    expect(SEASON1.dailyBudget).toBe(SEASON1.emissions / 90n);
    expect(SEASON1.dailyBudget * 90n).toBeLessThanOrEqual(SEASON1.emissions);
    expect(SEASON1.emissions - SEASON1.dailyBudget * 90n).toBeLessThan(90n);
  });

  it("rekt rows only on rektCapable locations, paying rows carry multipliers", () => {
    for (const loc of SEASON1_LOCATIONS) {
      for (const row of loc.table) {
        if (row.outcome === "rekt_items" || row.outcome === "rekt_character") {
          expect(loc.rektCapable).toBe(true);
        }
        if (row.outcome === "win" || row.outcome === "jackpot") {
          expect(row.multiplierBps ?? 0).toBeGreaterThan(10_000);
        }
      }
    }
  });
});

describe("checkSeasonInvariant", () => {
  const fullBudget = { remainingBudget: SEASON1.emissions, remainingDays: SEASON1.days };

  it("accepts the frozen S1 config at modest load (500 DAU, 500 avg stake)", () => {
    const result = checkSeasonInvariant(SEASON1_LOCATIONS, {
      dau: 500,
      avgStake: toBaseUnits(500),
      ...fullBudget,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an over-tuned config (multipliers x4 at 1000 DAU)", () => {
    const overTuned: LocationConfig[] = SEASON1_LOCATIONS.map((loc) => ({
      ...loc,
      table: loc.table.map((row) =>
        row.multiplierBps !== undefined ? { ...row, multiplierBps: row.multiplierBps * 4 } : { ...row },
      ),
    }));
    const result = checkSeasonInvariant(overTuned, {
      dau: 1_000,
      avgStake: toBaseUnits(1_000),
      ...fullBudget,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exceeds allowed/);
  });

  it("rejects when the remaining budget is nearly gone", () => {
    const result = checkSeasonInvariant(SEASON1_LOCATIONS, {
      dau: 2_000,
      avgStake: toBaseUnits(1_000),
      remainingBudget: toBaseUnits(1_000_000),
      remainingDays: 30,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects nonsensical inputs", () => {
    expect(
      checkSeasonInvariant(SEASON1_LOCATIONS, {
        dau: 100,
        avgStake: toBaseUnits(100),
        remainingBudget: SEASON1.emissions,
        remainingDays: 0,
      }).ok,
    ).toBe(false);
  });
});
