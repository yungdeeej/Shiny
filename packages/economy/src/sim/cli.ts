/**
 * Sim CLI (node-only — everything else in this package is isomorphic).
 *   pnpm --filter @trash-wars/economy sim -- --days 180 --players 2000 --dau-curve growth --seed 42
 * Writes markdown + CSV reports to packages/economy/reports/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSim } from "./engine.js";
import { renderCsv, renderMarkdown } from "./report.js";
import type { DauCurve, SimOptions } from "./types.js";

function parseArgs(argv: string[]): SimOptions {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const days = Number(get("days") ?? 180);
  const players = Number(get("players") ?? 2_000);
  const curve = (get("dau-curve") ?? "growth") as DauCurve;
  const seedRaw = get("seed") ?? "42";
  if (!Number.isInteger(days) || days <= 0) throw new Error(`invalid --days: ${get("days")}`);
  if (!Number.isInteger(players) || players <= 0) throw new Error(`invalid --players: ${get("players")}`);
  if (!["growth", "plateau", "decay"].includes(curve)) throw new Error(`invalid --dau-curve: ${curve}`);
  const seed = /^\d+$/.test(seedRaw) ? Number(seedRaw) : seedRaw;
  return { days, players, dauCurve: curve, seed };
}

const options = parseArgs(process.argv.slice(2));
const started = Date.now();
const result = runSim(options);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const reportsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "reports");
mkdirSync(reportsDir, { recursive: true });
const baseName = `${options.dauCurve}-${options.players}`;
const mdPath = join(reportsDir, `${baseName}.md`);
const csvPath = join(reportsDir, `${baseName}.csv`);
writeFileSync(mdPath, renderMarkdown(result));
writeFileSync(csvPath, renderCsv(result));

console.log(`sim: ${options.days} days, ${options.players} players, ${options.dauCurve} curve, seed ${options.seed} (${elapsed}s)`);
for (const note of result.notes) console.log(`  - ${note}`);
console.log(`wrote ${mdPath}`);
console.log(`wrote ${csvPath}`);
