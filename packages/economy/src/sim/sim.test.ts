import { describe, expect, it } from "vitest";
import { runSim } from "./engine.js";
import { renderCsv, renderMarkdown } from "./report.js";

describe("simulator conservation", () => {
  const result = runSim({ days: 30, players: 200, dauCurve: "growth", seed: 42 });

  it("produces one row per day", () => {
    expect(result.rows).toHaveLength(30);
  });

  it("holds the ledger identity every simulated day incl. jackpotPool (no token leaks)", () => {
    for (const row of result.rows) {
      // deposited + emissionsSpent === balances + burned + pdPool + jackpotPool + treasury + withdrawn
      expect(row.deposited + row.emissionsSpent).toBe(
        row.playerBalances +
          row.burned +
          row.pdPool +
          row.jackpotPool +
          row.treasury +
          row.withdrawn,
      );
      // circulating definition is consistent
      expect(row.circulating).toBe(row.deposited + row.emissionsSpent - row.burned);
      // emissions never exceed the season reserve
      expect(row.emissionsRemaining).toBeGreaterThanOrEqual(0n);
    }
  });

  it("jackpot pool: seeded 2M day 0, accrues 5% of losses, never pays before day 56", () => {
    const seed = 2_000_000n * 1_000_000n;
    const first = result.rows[0]!;
    expect(first.jackpotPool).toBeGreaterThanOrEqual(seed);
    for (const row of result.rows) {
      expect(row.jackpotHits).toBe(0); // 30-day run — winnable starts day 56
      expect(row.dailyJackpotPaid).toBe(0n);
      // pool only grows pre-winnable: seed + cumulative 5% inflow
      expect(row.jackpotPool).toBeGreaterThanOrEqual(seed);
    }
    const last = result.rows[result.rows.length - 1]!;
    const totalIn = result.rows.reduce((s, r) => s + r.dailyJackpotIn, 0n);
    expect(last.jackpotPool).toBe(seed + totalIn);
    expect(totalIn).toBeGreaterThan(0n);
  });

  it("jackpot becomes winnable at day 56: pool pays out minus the 10% floor", () => {
    const long = runSim({ days: 70, players: 400, dauCurve: "plateau", seed: 42 });
    const hits = long.rows.reduce((s, r) => s + r.jackpotHits, 0);
    expect(hits).toBeGreaterThan(0);
    for (const row of long.rows) {
      if (row.day < 56) {
        expect(row.jackpotHits).toBe(0);
        expect(row.dailyJackpotPaid).toBe(0n);
      }
      expect(row.jackpotPool).toBeGreaterThan(0n); // the floor means it never zeroes
    }
  });

  it("reports a static tier distribution from the archetype mix", () => {
    const total = Object.values(result.tierDistribution).reduce((s, n) => s + n, 0);
    expect(total).toBe(200);
    expect(result.tierDistribution.kingpin).toBeGreaterThan(0); // whales
    expect(result.tierDistribution.alley).toBeGreaterThan(0); // grinders + tourists
  });

  it("is deterministic for the same seed", () => {
    const again = runSim({ days: 30, players: 200, dauCurve: "growth", seed: 42 });
    const last = result.rows[result.rows.length - 1];
    const lastAgain = again.rows[again.rows.length - 1];
    expect(lastAgain).toEqual(last);
  });

  it("diverges for a different seed", () => {
    const other = runSim({ days: 30, players: 200, dauCurve: "growth", seed: 43 });
    expect(other.rows[29]?.burned === result.rows[29]?.burned &&
      other.rows[29]?.playerBalances === result.rows[29]?.playerBalances).toBe(false);
  });

  it("activity actually happened (missions, burns, rake)", () => {
    const last = result.rows[result.rows.length - 1];
    expect(last).toBeDefined();
    if (!last) return;
    expect(result.rows.reduce((s, r) => s + r.missions, 0)).toBeGreaterThan(1_000);
    expect(last.burned).toBeGreaterThan(0n);
    expect(last.treasury).toBeGreaterThan(0n);
    expect(last.emissionsSpent).toBeGreaterThan(0n);
  });

  it("PD pool only distributes after activation day 30", () => {
    const short = runSim({ days: 25, players: 200, dauCurve: "plateau", seed: 7 });
    for (const row of short.rows) expect(row.dailyPdDistributed).toBe(0n);
  });

  it("renders markdown and csv without crashing", () => {
    const md = renderMarkdown(result);
    const csv = renderCsv(result);
    expect(md).toContain("Season 1 location EVs");
    expect(csv.split("\n")[0]).toContain("day,dau,missions");
    expect(csv.trim().split("\n")).toHaveLength(31); // header + 30 days
  });
});
