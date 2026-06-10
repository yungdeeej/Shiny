#!/usr/bin/env node
/**
 * Economy-sim regression gate (doc 13 §5.1).
 *
 * Re-runs the three standard scenarios and asserts the S1 acceptance bands:
 *   - zero daily-clamp days inside Season 1 (days 0–89)
 *   - bloodhound APR (staked basis) avg of days 60–89 within [30%, 50%]
 *   - net inflation avg of days 60–89 within [-1.0%, +0.15%] per day
 *
 * CI fails the PR if any band breaks. Run locally: node ops/check-sim-bands.mjs
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reports = path.join(root, "packages/economy/reports");
const SCENARIOS = ["growth", "plateau", "decay"];

const APR_BAND = [30, 50]; // percent, staked-hound basis
const INFLATION_BAND = [-1.0, 0.15]; // percent per day

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`  ✗ ${msg}`);
};

for (const scenario of SCENARIOS) {
  console.log(`── ${scenario} (2000 players, 180d, seed 42)`);
  execSync(
    `pnpm --filter @trash-wars/economy sim -- --days 180 --players 2000 --dau-curve ${scenario} --seed 42`,
    { cwd: root, stdio: "pipe" },
  );

  const csv = readFileSync(path.join(reports, `${scenario}-2000.csv`), "utf8").trim().split("\n");
  const header = csv[0].split(",");
  const col = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`column ${name} missing from sim CSV`);
    return i;
  };
  const rows = csv.slice(1).map((l) => l.split(","));
  const day = col("day");
  const shortfall = col("budgetShortfall");
  const apr = col("pdAprStakedBps");
  const infl = col("netInflationBps");

  const s1 = rows.filter((r) => Number(r[day]) < 90);
  const clampDays = s1.filter((r) => r[shortfall] === "true").length;
  if (clampDays > 0) fail(`${clampDays} emissions-clamp day(s) inside S1 (must be 0)`);
  else console.log(`  ✓ 0 clamp days in S1`);

  const window = rows.filter((r) => Number(r[day]) >= 60 && Number(r[day]) <= 89);
  const avg = (i) => window.reduce((s, r) => s + Number(r[i]), 0) / window.length;

  const aprPct = avg(apr) / 100;
  if (aprPct < APR_BAND[0] || aprPct > APR_BAND[1])
    fail(`APR (staked) d60–89 = ${aprPct.toFixed(1)}% outside [${APR_BAND}]%`);
  else console.log(`  ✓ APR (staked) d60–89 = ${aprPct.toFixed(1)}%`);

  const inflPct = avg(infl) / 100;
  if (inflPct < INFLATION_BAND[0] || inflPct > INFLATION_BAND[1])
    fail(`net inflation d60–89 = ${inflPct.toFixed(2)}%/day outside [${INFLATION_BAND}]%`);
  else console.log(`  ✓ net inflation d60–89 = ${inflPct.toFixed(2)}%/day`);
}

if (failed) {
  console.error("\nSim regression gate FAILED — economy change breaks an S1 band.");
  process.exit(1);
}
console.log("\nSim regression gate passed.");
