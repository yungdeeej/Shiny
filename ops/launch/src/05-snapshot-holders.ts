/**
 * 05-snapshot-holders.ts — snapshot current NFT holders of a Metaplex collection
 * (e.g. The Heist) via the Helius DAS API, for airdrop targeting.
 *
 *   HELIUS_API_KEY=... pnpm --filter @trash-wars/launch-ops snapshot -- \
 *     --collection <collectionAddress> [--per-nft 100]
 *
 * Read-only. Pages getAssetsByGroup (1000/page) and writes
 * out/holders-<collection>.csv as "address,amount" rows directly consumable by
 * 04-airdrop.ts (amount = nft_count * --per-nft whole tokens, default 1 — i.e.
 * by default the CSV carries nft counts; set --per-nft to the airdrop rate).
 *
 * ⚠ DEVNET REHEARSAL NOTE: DAS response field names (`ownership.owner`,
 * `burnt`) follow the current Helius docs (docs.helius.dev → DAS API →
 * getAssetsByGroup); confirm against a live response during rehearsal.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { OUT_DIR, fail } from "./lib.js";
import path from "node:path";

interface DasAsset {
  id: string;
  burnt?: boolean;
  ownership?: { owner?: string };
}
interface DasResponse {
  result?: { items?: DasAsset[]; total?: number };
  error?: { message?: string };
}

// No --rpc/--keypair here: this script only talks to the Helius DAS endpoint.
const { values: flags } = parseArgs({
  options: {
    collection: { type: "string" },
    "per-nft": { type: "string", default: "1" },
  },
});
console.log("── 05-snapshot-holders (read-only) ──");

const collection = flags.collection as string | undefined;
if (!collection) fail("--collection <address> is required");
const perNft = Number(flags["per-nft"]);
const apiKey = process.env.HELIUS_API_KEY;
if (!apiKey) fail("HELIUS_API_KEY env is required");
const endpoint =
  process.env.HELIUS_RPC_URL ?? `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;

const PAGE_SIZE = 1000;
const counts = new Map<string, number>();
let page = 1;
let totalAssets = 0;

for (;;) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "snapshot",
      method: "getAssetsByGroup",
      params: { groupKey: "collection", groupValue: collection, page, limit: PAGE_SIZE },
    }),
  });
  if (!res.ok) fail(`Helius DAS HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as DasResponse;
  if (data.error) fail(`Helius DAS error: ${data.error.message}`);
  const items = data.result?.items ?? [];

  for (const asset of items) {
    if (asset.burnt) continue;
    const owner = asset.ownership?.owner;
    if (!owner) continue;
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  totalAssets += items.length;
  console.log(`   page ${page}: ${items.length} assets (${counts.size} unique holders so far)`);
  if (items.length < PAGE_SIZE) break;
  page += 1;
}

if (counts.size === 0) fail("no holders found — check the collection address");

const rows = [...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([owner, n]) => `${owner},${n * perNft}`);

mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `holders-${collection.slice(0, 8)}.csv`);
writeFileSync(outPath, "address,amount\n" + rows.join("\n") + "\n");

console.log(`\n✓ snapshot: ${totalAssets} NFTs, ${counts.size} holders → ${outPath}`);
console.log(`  (amount column = nft_count × ${perNft}; feed straight into 04-airdrop.ts)`);
