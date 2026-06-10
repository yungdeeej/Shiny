/**
 * buyback.ts — treasury buyback-and-burn (docs/09). MANUALLY triggered, never
 * automatic (automatic buybacks get front-run).
 *
 *   pnpm --filter @trash-wars/launch-ops buyback -- \
 *     --rpc <url> --keypair <buyback-reserve.json> --mint <SHINY mint> \
 *     --sol 25 --slippage-bps 50 --max-price-impact-pct 1.0 --execute
 *
 * Flow: Jupiter v6 quote (SOL → SHINY) → abort if priceImpactPct > threshold →
 * swap → burnChecked the actual received SHINY (measured as the ATA balance
 * delta, not the quoted amount) → manifest with both tx sigs + explorer links.
 *
 * JUPITER_API_URL env overrides the API base (default https://quote-api.jup.ag/v6).
 * Dry-run (default) fetches and prints the quote but sends nothing.
 */
import { burnChecked, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  banner,
  explorerTx,
  fail,
  formatShiny,
  getConnection,
  loadKeypair,
  parseFlags,
  SHINY_DECIMALS,
  withRetry,
  writeManifest,
} from "./lib.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_API_URL = process.env.JUPITER_API_URL ?? "https://quote-api.jup.ag/v6";

const flags = parseFlags({
  mint: { type: "string" },
  sol: { type: "string" },
  "slippage-bps": { type: "string", default: "50" },
  "max-price-impact-pct": { type: "string", default: "1.0" },
});
banner("buyback", flags);

const mintAddress = flags.mint as string | undefined;
const solStr = flags.sol as string | undefined;
if (!mintAddress || !solStr) fail("--mint <SHINY mint> and --sol <amount> are required");
const solAmount = Number(solStr);
if (!(solAmount > 0)) fail("--sol must be > 0");
const lamports = BigInt(Math.round(solAmount * LAMPORTS_PER_SOL));
const slippageBps = Number(flags["slippage-bps"]);
const maxPriceImpactPct = Number(flags["max-price-impact-pct"]);

const connection = getConnection(flags.rpc);
const wallet = loadKeypair(flags.keypairPath);
const mint = new PublicKey(mintAddress);
const shinyAta = getAssociatedTokenAddressSync(mint, wallet.publicKey);

console.log(`   wallet: ${wallet.publicKey.toBase58()}`);
console.log(`   swap: ${solAmount} SOL → SHINY  (slippage ${slippageBps} bps, abort if price impact > ${maxPriceImpactPct}%)`);
console.log(`   jupiter: ${JUPITER_API_URL}`);

/* ── 1. quote ──────────────────────────────────────────────────────── */

interface JupQuote {
  outAmount: string;
  priceImpactPct: string;
  routePlan?: unknown[];
  [k: string]: unknown;
}

const quoteUrl =
  `${JUPITER_API_URL}/quote?inputMint=${WSOL_MINT}&outputMint=${mintAddress}` +
  `&amount=${lamports}&slippageBps=${slippageBps}&swapMode=ExactIn`;
const quoteRes = await fetch(quoteUrl);
if (!quoteRes.ok) fail(`Jupiter quote HTTP ${quoteRes.status}: ${await quoteRes.text()}`);
const quote = (await quoteRes.json()) as JupQuote;

const expectedOut = BigInt(quote.outAmount);
const priceImpact = Number(quote.priceImpactPct) * 100; // Jupiter returns a fraction, e.g. "0.0123" = 1.23%
console.log(`   quote: ~${formatShiny(expectedOut)} SHINY, price impact ${priceImpact.toFixed(4)}%`);

if (!Number.isFinite(priceImpact)) fail("could not parse priceImpactPct from quote");
if (priceImpact > maxPriceImpactPct)
  fail(`price impact ${priceImpact.toFixed(4)}% exceeds threshold ${maxPriceImpactPct}% — ABORTING (reduce --sol or wait for depth)`);

if (!flags.execute) {
  console.log("\nDRY RUN — quote fetched, nothing sent. Re-run with --execute to swap + burn.");
  process.exit(0);
}

/* ── 2. swap ───────────────────────────────────────────────────────── */

async function shinyBalance(): Promise<bigint> {
  try {
    return (await getAccount(connection, shinyAta)).amount;
  } catch {
    return 0n;
  }
}

const balanceBefore = await shinyBalance();

const swapRes = await fetch(`${JUPITER_API_URL}/swap`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: wallet.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  }),
});
if (!swapRes.ok) fail(`Jupiter swap HTTP ${swapRes.status}: ${await swapRes.text()}`);
const { swapTransaction } = (await swapRes.json()) as { swapTransaction: string };

const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
tx.sign([wallet]);
const swapSig = await withRetry<string>("send swap", async () => {
  const sig = await connection.sendTransaction(tx, { maxRetries: 3 });
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  return sig;
});
console.log(`   ✓ swap: ${explorerTx(swapSig, flags.rpc)}`);

/* ── 3. burn the proceeds ──────────────────────────────────────────── */

const balanceAfter = await shinyBalance();
const received = balanceAfter - balanceBefore;
if (received <= 0n) fail("swap confirmed but no SHINY received — investigate before burning anything");
console.log(`   received ${formatShiny(received)} SHINY — burning…`);

const burnSig = await withRetry<string>("burn", () =>
  burnChecked(connection, wallet, shinyAta, mint, wallet, received, SHINY_DECIMALS),
);
console.log(`   ✓ burn: ${explorerTx(burnSig, flags.rpc)}`);

writeManifest(`buyback-${Date.now()}.json`, {
  script: "buyback",
  at: new Date().toISOString(),
  rpc: flags.rpc,
  mint: mintAddress,
  solIn: solAmount,
  slippageBps,
  priceImpactPct: priceImpact,
  quotedOutBaseUnits: quote.outAmount,
  receivedBaseUnits: received.toString(),
  burnedBaseUnits: received.toString(),
  txs: { swap: swapSig, burn: burnSig },
  explorer: { swap: explorerTx(swapSig, flags.rpc), burn: explorerTx(burnSig, flags.rpc) },
});
console.log(`\n✓ buyback complete: ${solAmount} SOL → ${formatShiny(received)} SHINY burned. Publish the manifest.`);
