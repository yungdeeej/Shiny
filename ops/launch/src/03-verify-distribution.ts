/**
 * 03-verify-distribution.ts — re-read chain state and assert every allocation
 * sits where the 02 manifest says. Read-only (no --execute needed).
 *
 *   pnpm --filter @trash-wars/launch-ops verify -- --rpc <url>
 *
 * Prints a markdown table suitable for the public allocations post.
 * Exits non-zero on any mismatch.
 */
import { getAccount, getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  explorerAddress,
  fail,
  formatShiny,
  getConnection,
  manifestExists,
  parseFlags,
  readManifest,
  TOTAL_SUPPLY_BASE,
} from "./lib.js";

interface DistributeManifest {
  mint: string;
  allocations: { label: string; address: string; ata: string; amountBaseUnits: string; txSig: string | null }[];
}

const flags = parseFlags({ manifest: { type: "string", default: "02-distribute.json" } });
console.log("── 03-verify-distribution (read-only) ──");

const manifestName = flags.manifest as string;
if (!manifestExists(manifestName)) fail(`out/${manifestName} not found — run 02-distribute first`);
const manifest = readManifest<DistributeManifest>(manifestName);

const connection = getConnection(flags.rpc);
const mint = new PublicKey(manifest.mint);

const mintInfo = await getMint(connection, mint);
const checks: string[] = [];
let ok = true;

function check(label: string, pass: boolean, detail: string) {
  checks.push(`${pass ? "✓" : "✗"} ${label}: ${detail}`);
  if (!pass) ok = false;
}

check("supply", mintInfo.supply === TOTAL_SUPPLY_BASE, `${formatShiny(mintInfo.supply)} SHINY`);
check("mint authority revoked", mintInfo.mintAuthority === null, String(mintInfo.mintAuthority ?? "null"));
check("freeze authority null", mintInfo.freezeAuthority === null, String(mintInfo.freezeAuthority ?? "null"));

const rows: string[] = [
  "| Allocation | Address | Expected | On-chain | Status |",
  "|---|---|---:|---:|---|",
];
for (const a of manifest.allocations) {
  const expected = BigInt(a.amountBaseUnits);
  let actual = 0n;
  try {
    actual = (await getAccount(connection, new PublicKey(a.ata))).amount;
  } catch {
    /* ATA missing → 0 */
  }
  const pass = actual >= expected;
  if (!pass) ok = false;
  rows.push(
    `| ${a.label} | \`${a.address}\` | ${formatShiny(expected)} | ${formatShiny(actual)} | ${pass ? "✅" : "❌ MISMATCH"} |`,
  );
}

console.log("\n" + checks.join("\n"));
console.log(`\n### $SHINY allocation verification — ${new Date().toISOString()}\n`);
console.log(`Mint: \`${manifest.mint}\` — ${explorerAddress(manifest.mint, flags.rpc)}\n`);
console.log(rows.join("\n"));
console.log("");

if (!ok) fail("verification FAILED — chain state does not match the manifest");
console.log("✓ all allocations verified on-chain.");
