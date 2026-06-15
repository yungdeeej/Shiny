/**
 * rarity-report.ts — print the trait distribution + rarity-tier counts of a
 * generated manifest, so the team can verify the curve.
 *
 *   tsx src/rarity-report.ts out/collection/manifest.json
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Manifest } from "./manifest.js";
import type { RarityTier } from "./rarity.js";

const RARITY_ORDER: RarityTier[] = ["common", "rare", "epic", "legendary"];

export function rarityReport(manifest: Manifest): string {
  const lines: string[] = [];
  const n = manifest.assets.length;
  lines.push(`Trash Wars collection — ${n} assets`);
  lines.push("");

  // faction split
  const byFaction: Record<string, number> = {};
  for (const a of manifest.assets) byFaction[a.faction] = (byFaction[a.faction] ?? 0) + 1;
  lines.push("FACTION");
  for (const [f, c] of Object.entries(byFaction)) lines.push(`  ${f.padEnd(12)} ${c} (${pct(c, n)})`);
  lines.push("");

  // rarity tiers
  const byTier: Record<string, number> = {};
  for (const a of manifest.assets) byTier[a.rarity] = (byTier[a.rarity] ?? 0) + 1;
  lines.push("RARITY TIER");
  for (const t of RARITY_ORDER) {
    const c = byTier[t] ?? 0;
    lines.push(`  ${t.padEnd(12)} ${String(c).padStart(4)} (${pct(c, n)})  ${bar(c, n)}`);
  }
  lines.push("");

  // trait distribution (per slot, per faction)
  const slots: Record<string, Record<string, number>> = {};
  for (const a of manifest.assets) {
    for (const [slot, id] of Object.entries(a.traits)) {
      const key = `${a.faction}.${slot}`;
      slots[key] = slots[key] ?? {};
      slots[key][id] = (slots[key][id] ?? 0) + 1;
    }
  }
  lines.push("TRAIT DISTRIBUTION");
  for (const key of Object.keys(slots).sort()) {
    const dist = slots[key]!;
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    lines.push(`  ${key}`);
    for (const [id, c] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
      lines.push(`      ${id.padEnd(16)} ${String(c).padStart(4)} (${pct(c, total)})`);
    }
  }
  return lines.join("\n");
}

function pct(c: number, n: number): string {
  return n ? `${((c / n) * 100).toFixed(1)}%` : "0%";
}
function bar(c: number, n: number): string {
  const len = n ? Math.round((c / n) * 24) : 0;
  return "█".repeat(len);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mp = process.argv[2] ?? "out/collection/manifest.json";
  const manifest = JSON.parse(readFileSync(mp, "utf8")) as Manifest;
  console.log(rarityReport(manifest));
}
