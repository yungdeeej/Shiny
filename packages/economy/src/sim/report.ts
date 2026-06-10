/** Render sim results to markdown + CSV. Pure string builders — the CLI does the IO. */
import { SEASON1, SEASON1_LOCATIONS } from "../config/season1.js";
import { computeEvBps, computePayoutEvBps } from "../resolve.js";
import type { DayRow, SimResult } from "./types.js";

const UNIT = 1_000_000n;

/** base units -> whole SHINY string (floor). */
function shiny(v: bigint): string {
  return (v / UNIT).toString();
}

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

const CSV_COLUMNS = [
  "day",
  "dau",
  "missions",
  "arrests",
  "confiscations",
  "rekts",
  "playerBalances",
  "deposited",
  "withdrawn",
  "burned",
  "pdPool",
  "treasury",
  "emissionsSpent",
  "emissionsRemaining",
  "circulating",
  "dailyEmissions",
  "dailyBurned",
  "dailyRake",
  "dailyPdDistributed",
  "dailyWinExcess",
  "dailyIdle",
  "budgetShortfall",
  "netInflationBps",
  "redistributionShareBps",
  "pdAprBps",
] as const;

export function renderCsv(result: SimResult): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of result.rows) {
    lines.push(
      CSV_COLUMNS.map((col) => {
        const v = row[col];
        return typeof v === "bigint" ? v.toString() : String(v);
      }).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function sampleRows(rows: DayRow[]): DayRow[] {
  if (rows.length <= 40) return rows;
  const step = Math.ceil(rows.length / 36);
  const out = rows.filter((r) => r.day % step === 0);
  const last = rows[rows.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

export function renderMarkdown(result: SimResult): string {
  const { options, rows, notes } = result;
  const last = rows[rows.length - 1];
  const lines: string[] = [];

  lines.push(`# Trash Wars economy sim — ${options.dauCurve}, ${options.players} players`);
  lines.push("");
  lines.push(
    `Days: ${options.days} · Seed: ${options.seed} · Mix: ` +
      Object.entries(options.mix)
        .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
        .join(", "),
  );
  lines.push("");

  lines.push("## Season 1 location EVs (per doc-01 convention, paying rows only)");
  lines.push("");
  lines.push("| Location | Duration | EV (×stake) | Full payout EV incl. returned stake (×stake) |");
  lines.push("|---|---|---|---|");
  for (const loc of SEASON1_LOCATIONS) {
    lines.push(
      `| ${loc.name} | ${loc.durationHours}h | ${(computeEvBps(loc.table) / 10_000).toFixed(2)} | ` +
        `${(computePayoutEvBps(loc.table) / 10_000).toFixed(2)} |`,
    );
  }
  lines.push("");

  if (last) {
    lines.push("## Summary (end of run)");
    lines.push("");
    lines.push(`- Circulating: **${shiny(last.circulating)} SHINY**`);
    lines.push(`- Burned (cumulative): **${shiny(last.burned)} SHINY**`);
    lines.push(
      `- Emissions spent: **${shiny(last.emissionsSpent)} / ${shiny(SEASON1.emissions)} SHINY** ` +
        `(remaining ${shiny(last.emissionsRemaining)})`,
    );
    lines.push(`- Treasury rake: **${shiny(last.treasury)} SHINY**`);
    lines.push(`- Withdrawn off-game (net of tax): **${shiny(last.withdrawn)} SHINY**`);
    lines.push(`- Deposited (buy pressure): **${shiny(last.deposited)} SHINY**`);
    lines.push(`- PD pool balance: **${shiny(last.pdPool)} SHINY**`);
    lines.push(`- Final-day net inflation: ${pct(last.netInflationBps)} of circulating`);
    lines.push(`- Final-day redistribution share of player earnings: ${pct(last.redistributionShareBps)}`);
    lines.push(`- Final-day PD APR: ${pct(last.pdAprBps)}`);
    lines.push("");
  }

  if (notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const note of notes) lines.push(`- ${note}`);
    lines.push("");
  }

  lines.push("## Daily samples (whole SHINY)");
  lines.push("");
  lines.push(
    "| Day | DAU | Missions | Emitted | Burned | Rake | PD dist | PD pool | Circulating | Net infl | Redist | Shortfall |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of sampleRows(rows)) {
    lines.push(
      `| ${r.day} | ${r.dau} | ${r.missions} | ${shiny(r.dailyEmissions)} | ${shiny(r.dailyBurned)} | ` +
        `${shiny(r.dailyRake)} | ${shiny(r.dailyPdDistributed)} | ${shiny(r.pdPool)} | ` +
        `${shiny(r.circulating)} | ${pct(r.netInflationBps)} | ${pct(r.redistributionShareBps)} | ` +
        `${r.budgetShortfall ? "yes" : ""} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
