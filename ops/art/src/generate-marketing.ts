/**
 * generate-marketing.ts — render the doc-12 campaign card set to out/marketing/.
 *
 *   pnpm gen:marketing
 *
 * Writes one PNG per card so the team (and the Sentinel) can see the set.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  burnCard,
  factionCard,
  heroCard,
  statsCard,
  traitSheet,
  vaultTeaser,
  wantedPoster,
} from "./marketing.js";
import { renderPng } from "./render.js";

interface Card {
  name: string;
  svg: string;
}

export function buildCardSet(): Card[] {
  return [
    { name: "hero-x-header", svg: heroCard({ size: "xHeader" }) },
    { name: "hero-share", svg: heroCard({ size: "share", tagline: "BURN $SHINY. RUN THE ODDS. DON'T GET REKT." }) },
    { name: "faction-raccoons", svg: factionCard({ faction: "raccoon" }) },
    { name: "faction-bloodhounds", svg: factionCard({ faction: "bloodhound" }) },
    { name: "faction-crows-teaser", svg: factionCard({ faction: "crow" }) },
    { name: "trait-sheet-24", svg: traitSheet({ count: 24, faction: "mixed", seed: "showcase" }) },
    { name: "wanted-trashking", svg: wantedPoster({ handle: "TrashKing", bounty: "180,000 $SHINY", crime: "12× HEIST AT FIRST NATIONAL" }) },
    { name: "burn-weekly", svg: burnCard({ amount: "14.2M $SHINY", txSig: "5KJp9aQ2vR7xN3mB", weekLabel: "WEEK 6 · ON-CHAIN · RECEIPTED" }) },
    {
      name: "stats-monday",
      svg: statsCard({
        rows: [
          { label: "Players (7d)", value: "2,184" },
          { label: "Missions run", value: "48,902" },
          { label: "$SHINY burned", value: "14.2M" },
          { label: "Jackpot pool", value: "2.41M" },
          { label: "Characters rekt", value: "37" },
        ],
      }),
    },
    { name: "vault-teaser", svg: vaultTeaser({ amount: "2,418,900 $SHINY", climbing: true }) },
  ];
}

export async function generateMarketing(outDir = "out/marketing"): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const card of buildCardSet()) {
    const png = await renderPng(card.svg);
    const file = path.join(outDir, `${card.name}.png`);
    writeFileSync(file, png);
    written.push(file);
    console.log(`✓ ${card.name}.png`);
  }
  console.log(`\n${written.length} marketing cards → ${outDir}`);
  return written;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const out = process.argv[2] ?? "out/marketing";
  generateMarketing(out).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
