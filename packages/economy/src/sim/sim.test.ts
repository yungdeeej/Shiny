import { describe, expect, it } from "vitest";
import { runSim } from "./engine.js";
import { renderCsv, renderMarkdown } from "./report.js";

describe("simulator conservation", () => {
  const result = runSim({ days: 30, players: 200, dauCurve: "growth", seed: 42 });

  it("produces one row per day", () => {
    expect(result.rows).toHaveLength(30);
  });

  it("holds the ledger identity every simulated day (no token leaks)", () => {
    for (const row of result.rows) {
      // deposited + emissionsSpent === balances + burned + pdPool + treasury + withdrawn
      expect(row.deposited + row.emissionsSpent).toBe(
        row.playerBalances + row.burned + row.pdPool + row.treasury + row.withdrawn,
      );
      // circulating definition is consistent
      expect(row.circulating).toBe(row.deposited + row.emissionsSpent - row.burned);
      // emissions never exceed the season reserve
      expect(row.emissionsRemaining).toBeGreaterThanOrEqual(0n);
    }
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
