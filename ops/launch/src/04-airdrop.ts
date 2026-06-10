/**
 * 04-airdrop.ts — batch SPL transfers from a CSV (beta testers + Heist holders).
 *
 *   pnpm --filter @trash-wars/launch-ops airdrop -- \
 *     --rpc <url> --keypair <airdrop-wallet.json> --mint <mint> --csv ./airdrop.csv --execute
 *
 * CSV format: "address,amount" per line (amount in whole tokens; an optional
 * header line "address,amount" is skipped). Designed for 1000+ recipients:
 *   - chunked: N recipients per transaction (--chunk-size, default 5 —
 *     each recipient costs 2 instructions: idempotent ATA create + transferChecked)
 *   - retry with exponential backoff per chunk
 *   - resumable: out/airdrop-checkpoint.json records completed recipients keyed
 *     to a hash of the CSV, so a crashed run picks up where it left off.
 *     Re-running a completed airdrop is a no-op (idempotent).
 */
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  banner,
  explorerTx,
  fail,
  formatShiny,
  getConnection,
  loadKeypair,
  manifestPath,
  parseFlags,
  SHINY_DECIMALS,
  sha256Hex,
  sleep,
  toBaseUnits,
  withRetry,
  writeManifest,
} from "./lib.js";

const CHECKPOINT = "airdrop-checkpoint.json";

interface Checkpoint {
  csvSha256: string;
  mint: string;
  /** address → tx signature */
  completed: Record<string, string>;
}

const flags = parseFlags({
  csv: { type: "string" },
  mint: { type: "string" },
  "chunk-size": { type: "string", default: "5" },
});
banner("04-airdrop", flags);

const csvPath = flags.csv as string | undefined;
const mintAddress = flags.mint as string | undefined;
if (!csvPath || !mintAddress) fail("--csv <file> and --mint <address> are required");
const chunkSize = Math.max(1, Number(flags["chunk-size"]));

const csvRaw = readFileSync(csvPath, "utf8");
const csvHash = sha256Hex(csvRaw);
const recipients = csvRaw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !/^address\s*,/i.test(l))
  .map((line, i) => {
    const [address, amount] = line.split(",").map((s) => s.trim());
    if (!address || !amount) fail(`csv line ${i + 1}: expected "address,amount"`);
    new PublicKey(address); // validate
    return { address, amountBase: toBaseUnits(amount) };
  });

const dupes = new Set<string>();
for (const r of recipients) {
  if (dupes.has(r.address)) fail(`duplicate recipient ${r.address} — dedupe the CSV first`);
  dupes.add(r.address);
}

// Load / validate checkpoint (resume support)
const checkpointFile = manifestPath(CHECKPOINT);
let checkpoint: Checkpoint = { csvSha256: csvHash, mint: mintAddress, completed: {} };
if (existsSync(checkpointFile)) {
  const existing = JSON.parse(readFileSync(checkpointFile, "utf8")) as Checkpoint;
  if (existing.csvSha256 !== csvHash || existing.mint !== mintAddress)
    fail(`out/${CHECKPOINT} belongs to a different CSV/mint — move it aside to start a new airdrop`);
  checkpoint = existing;
  console.log(`   resuming: ${Object.keys(checkpoint.completed).length}/${recipients.length} already done`);
}

const pending = recipients.filter((r) => !checkpoint.completed[r.address]);
const totalPending = pending.reduce((s, r) => s + r.amountBase, 0n);
console.log(`   recipients: ${recipients.length} total, ${pending.length} pending (${formatShiny(totalPending)} SHINY)`);

if (pending.length === 0) {
  console.log("✓ airdrop already complete — nothing to do.");
  process.exit(0);
}

if (!flags.execute) {
  console.log(`\nDRY RUN — would send ${Math.ceil(pending.length / chunkSize)} transaction(s) of up to ${chunkSize} recipients each. Re-run with --execute.`);
  process.exit(0);
}

const connection = getConnection(flags.rpc);
const payer = loadKeypair(flags.keypairPath);
const mint = new PublicKey(mintAddress);
const sourceAta = getAssociatedTokenAddressSync(mint, payer.publicKey);

function saveCheckpoint() {
  writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2) + "\n");
}

for (let i = 0; i < pending.length; i += chunkSize) {
  const chunk = pending.slice(i, i + chunkSize);
  const sig = await withRetry(`chunk ${i / chunkSize + 1}`, async () => {
    const tx = new Transaction();
    for (const r of chunk) {
      const owner = new PublicKey(r.address);
      const destAta = getAssociatedTokenAddressSync(mint, owner, true);
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, destAta, owner, mint),
        createTransferCheckedInstruction(sourceAta, mint, destAta, payer.publicKey, r.amountBase, SHINY_DECIMALS),
      );
    }
    return sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
  });
  for (const r of chunk) checkpoint.completed[r.address] = sig;
  saveCheckpoint();
  const done = Object.keys(checkpoint.completed).length;
  console.log(`   ✓ ${done}/${recipients.length}  ${explorerTx(sig, flags.rpc)}`);
  await sleep(250); // be gentle on the RPC
}

writeManifest(
  `04-airdrop-${csvHash.slice(0, 8)}.json`,
  {
    script: "04-airdrop",
    at: new Date().toISOString(),
    rpc: flags.rpc,
    mint: mintAddress,
    csvSha256: csvHash,
    recipients: recipients.length,
    totalBaseUnits: recipients.reduce((s, r) => s + r.amountBase, 0n).toString(),
    completed: checkpoint.completed,
  },
  true,
);
console.log("\n✓ 04-airdrop complete.");
