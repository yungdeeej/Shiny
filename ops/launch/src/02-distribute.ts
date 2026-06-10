/**
 * 02-distribute.ts — distribute the 1B supply per the docs/01 allocation split.
 *
 *   pnpm --filter @trash-wars/launch-ops distribute -- \
 *     --rpc <url> --keypair <authority.json> --distribution ./distribution.json --execute
 *
 * Reads distribution.json: [{ "label", "address", "amount" }] with amounts in
 * WHOLE tokens. Validates the sum is exactly 1,000,000,000. See
 * distribution.example.json (emissions_multisig 700M, vault_source 120M,
 * liquidity 100M, marketing 50M, airdrop 30M).
 *
 * Idempotency: each destination's ATA balance is read first — allocations that
 * already hold >= their amount are skipped; partially-funded destinations abort
 * the run (human review needed). Refuses to run if out/02-distribute.json exists.
 *
 * Output: signed manifest (ed25519 over the allocations payload) at
 * out/02-distribute.json.
 */
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import {
  banner,
  explorerTx,
  fail,
  formatShiny,
  getConnection,
  loadKeypair,
  manifestExists,
  parseFlags,
  readManifest,
  SHINY_DECIMALS,
  signManifest,
  toBaseUnits,
  TOTAL_SUPPLY_BASE,
  withRetry,
  writeManifest,
} from "./lib.js";

const MANIFEST = "02-distribute.json";

interface Allocation {
  label: string;
  address: string;
  amount: number | string;
}

const flags = parseFlags({
  distribution: { type: "string", default: "distribution.json" },
  mint: { type: "string" },
});
banner("02-distribute", flags);

if (manifestExists(MANIFEST))
  fail(`out/${MANIFEST} exists — distribution already ran (double-run guard).`);

const mintAddress =
  (flags.mint as string | undefined) ??
  (manifestExists("01-mint-token.json")
    ? (readManifest<{ mint: string }>("01-mint-token.json").mint)
    : undefined);
if (!mintAddress) fail("--mint <address> required (or run 01-mint-token first)");
const mint = new PublicKey(mintAddress);

const allocations = JSON.parse(readFileSync(flags.distribution as string, "utf8")) as Allocation[];
if (!Array.isArray(allocations) || allocations.length === 0) fail("distribution.json: expected a non-empty array");

const sum = allocations.reduce((s, a) => s + toBaseUnits(a.amount), 0n);
if (sum !== TOTAL_SUPPLY_BASE)
  fail(`allocation sum ${formatShiny(sum)} != 1,000,000,000 — fix distribution.json`);

const seenLabels = new Set<string>();
for (const a of allocations) {
  if (seenLabels.has(a.label)) fail(`duplicate label ${a.label}`);
  seenLabels.add(a.label);
  new PublicKey(a.address); // throws on invalid address
}

const connection = getConnection(flags.rpc);
const authority = loadKeypair(flags.keypairPath);
// allowOwnerOffCurve: Squads multisig vaults are PDAs.
const sourceAta = getAssociatedTokenAddressSync(mint, authority.publicKey);

console.log(`   mint: ${mint.toBase58()}`);
console.log(`   source ATA: ${sourceAta.toBase58()}`);

async function destBalance(owner: PublicKey): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  try {
    return (await getAccount(connection, ata)).amount;
  } catch {
    return 0n; // ATA does not exist yet
  }
}

const plan: { label: string; address: string; amountBase: bigint; status: "pending" | "already-funded" }[] = [];
for (const a of allocations) {
  const amountBase = toBaseUnits(a.amount);
  const existing = await destBalance(new PublicKey(a.address));
  if (existing >= amountBase) {
    console.log(`   ✓ ${a.label}: already holds ${formatShiny(existing)} — skipping`);
    plan.push({ label: a.label, address: a.address, amountBase, status: "already-funded" });
  } else if (existing > 0n) {
    fail(`${a.label} holds a PARTIAL balance (${formatShiny(existing)} / ${formatShiny(amountBase)}) — refusing; resolve manually`);
  } else {
    console.log(`   • ${a.label}: ${formatShiny(amountBase)} SHINY → ${a.address}`);
    plan.push({ label: a.label, address: a.address, amountBase, status: "pending" });
  }
}

if (!flags.execute) {
  console.log(`\nDRY RUN — ${plan.filter((p) => p.status === "pending").length} transfer(s) would be sent. Re-run with --execute.`);
  process.exit(0);
}

const results: { label: string; address: string; ata: string; amountBaseUnits: string; txSig: string | null }[] = [];
for (const p of plan) {
  const owner = new PublicKey(p.address);
  const destAta = getAssociatedTokenAddressSync(mint, owner, true);
  if (p.status === "already-funded") {
    results.push({ label: p.label, address: p.address, ata: destAta.toBase58(), amountBaseUnits: p.amountBase.toString(), txSig: null });
    continue;
  }
  const sig = await withRetry(`transfer ${p.label}`, async () => {
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, destAta, owner, mint),
      createTransferCheckedInstruction(sourceAta, mint, destAta, authority.publicKey, p.amountBase, SHINY_DECIMALS),
    );
    return sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
  });
  console.log(`   ✓ ${p.label}: ${explorerTx(sig, flags.rpc)}`);
  results.push({ label: p.label, address: p.address, ata: destAta.toBase58(), amountBaseUnits: p.amountBase.toString(), txSig: sig });
}

const payload = {
  script: "02-distribute",
  at: new Date().toISOString(),
  rpc: flags.rpc,
  mint: mint.toBase58(),
  source: authority.publicKey.toBase58(),
  allocations: results,
};
writeManifest(MANIFEST, { ...payload, signature: signManifest(authority, payload) });
console.log("\n✓ 02-distribute complete. Run 03-verify-distribution next.");
