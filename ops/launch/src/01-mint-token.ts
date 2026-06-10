/**
 * 01-mint-token.ts — create the $SHINY mint.
 *
 *   pnpm --filter @trash-wars/launch-ops mint -- \
 *     --rpc https://api.devnet.solana.com --keypair ~/.config/solana/authority.json \
 *     --metadata-uri https://shiny.trashwars.example/metadata.json --execute
 *
 * Steps (execute mode):
 *   1. Create plain SPL mint, 6 decimals, freeze authority = null from genesis.
 *   2. Mint 1,000,000,000 SHINY to the authority's ATA.
 *   3. Attach Metaplex token metadata (name "Shiny", symbol "SHINY", immutable).
 *   4. Revoke mint authority.
 *   5. Re-read chain state and assert: supply == 1B, mintAuthority == null,
 *      freezeAuthority == null.
 *
 * Idempotency: refuses to run if out/01-mint-token.json already exists.
 */
import {
  AuthorityType,
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  type Account,
} from "@solana/spl-token";
import { Keypair, type PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  banner,
  explorerAddress,
  explorerTx,
  fail,
  formatShiny,
  getConnection,
  loadKeypair,
  manifestExists,
  parseFlags,
  SHINY_DECIMALS,
  TOTAL_SUPPLY_BASE,
  withRetry,
  writeManifest,
} from "./lib.js";

const MANIFEST = "01-mint-token.json";

const flags = parseFlags({
  "metadata-uri": { type: "string" },
  name: { type: "string", default: "Shiny" },
  symbol: { type: "string", default: "SHINY" },
});

banner("01-mint-token", flags);

const metadataUri = flags["metadata-uri"] as string | undefined;
if (!metadataUri) fail("--metadata-uri <https://...> is required");
const tokenName = flags.name as string;
const tokenSymbol = flags.symbol as string;

if (manifestExists(MANIFEST))
  fail(`out/${MANIFEST} exists — the mint script already ran. Delete the manifest only if you are certain (devnet rehearsal resets).`);

const connection = getConnection(flags.rpc);
const authority = loadKeypair(flags.keypairPath);
console.log(`   authority: ${authority.publicKey.toBase58()}`);
console.log(`   token: ${tokenName} (${tokenSymbol}), ${SHINY_DECIMALS} decimals, supply ${formatShiny(TOTAL_SUPPLY_BASE)}`);
console.log(`   metadata uri: ${metadataUri} (immutable)`);

if (!flags.execute) {
  console.log("\nDRY RUN — would: create mint → mint 1B to authority ATA → attach metadata → revoke mint authority.");
  console.log("Re-run with --execute to send.");
  process.exit(0);
}

/**
 * Attach Metaplex token-metadata (v3, createV1) to an *existing* SPL mint.
 *
 * ⚠ DEVNET REHEARSAL REQUIRED: mpl-token-metadata v3 `createV1` against a
 * pre-existing mint (mint passed as PublicKey, authority = current mint
 * authority, isMutable: false) is the documented path, but the umi API surface
 * has churned between minor versions. Verify the exact arg shape on devnet
 * before mainnet. Isolated here so a swap to `createMetadataAccountV3` (the
 * legacy instruction) is a one-function change.
 */
async function attachMetadata(rpc: string, mintAddress: string, kp: Keypair): Promise<string> {
  const { createUmi } = await import("@metaplex-foundation/umi-bundle-defaults");
  const { keypairIdentity, percentAmount, publicKey } = await import("@metaplex-foundation/umi");
  const { createV1, mplTokenMetadata, TokenStandard } = await import(
    "@metaplex-foundation/mpl-token-metadata"
  );

  const umi = createUmi(rpc).use(mplTokenMetadata());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(kp.secretKey)));

  const result = await createV1(umi, {
    mint: publicKey(mintAddress),
    authority: umi.identity,
    name: tokenName,
    symbol: tokenSymbol,
    uri: metadataUri!,
    sellerFeeBasisPoints: percentAmount(0),
    decimals: SHINY_DECIMALS,
    tokenStandard: TokenStandard.Fungible,
    isMutable: false,
  }).sendAndConfirm(umi);

  return bs58.encode(result.signature);
}

console.log("\n1/5 creating mint (freeze authority: null)…");
const mint = await withRetry<PublicKey>("createMint", () =>
  createMint(connection, authority, authority.publicKey, null, SHINY_DECIMALS),
);
console.log(`   mint: ${mint.toBase58()}`);
console.log(`   ${explorerAddress(mint, flags.rpc)}`);

console.log("2/5 creating authority ATA + minting full supply…");
const ata = await withRetry<Account>("getOrCreateATA", () =>
  getOrCreateAssociatedTokenAccount(connection, authority, mint, authority.publicKey),
);
const mintSig = await withRetry<string>("mintTo", () =>
  mintTo(connection, authority, mint, ata.address, authority, TOTAL_SUPPLY_BASE),
);
console.log(`   minted ${formatShiny(TOTAL_SUPPLY_BASE)} SHINY → ${ata.address.toBase58()}`);
console.log(`   ${explorerTx(mintSig, flags.rpc)}`);

console.log("3/5 attaching token metadata (immutable)…");
const metadataSig = await withRetry<string>("createMetadata", () =>
  attachMetadata(flags.rpc, mint.toBase58(), authority),
);
console.log(`   ${explorerTx(metadataSig, flags.rpc)}`);

console.log("4/5 revoking mint authority…");
const revokeSig = await withRetry<string>("revokeMintAuthority", () =>
  setAuthority(connection, authority, mint, authority, AuthorityType.MintTokens, null),
);
console.log(`   ${explorerTx(revokeSig, flags.rpc)}`);

console.log("5/5 verifying chain state…");
const info = await getMint(connection, mint);
if (info.mintAuthority !== null) fail("mint authority is NOT null after revoke");
if (info.freezeAuthority !== null) fail("freeze authority is NOT null");
if (info.supply !== TOTAL_SUPPLY_BASE)
  fail(`supply mismatch: ${info.supply} != ${TOTAL_SUPPLY_BASE}`);
console.log("   ✓ supply = 1B, mintAuthority = null, freezeAuthority = null");

writeManifest(MANIFEST, {
  script: "01-mint-token",
  at: new Date().toISOString(),
  rpc: flags.rpc,
  mint: mint.toBase58(),
  authority: authority.publicKey.toBase58(),
  authorityAta: ata.address.toBase58(),
  decimals: SHINY_DECIMALS,
  supplyBaseUnits: TOTAL_SUPPLY_BASE.toString(),
  metadata: { name: tokenName, symbol: tokenSymbol, uri: metadataUri, immutable: true },
  txs: { mintTo: mintSig, createMetadata: metadataSig, revokeMintAuthority: revokeSig },
  explorer: {
    mint: explorerAddress(mint, flags.rpc),
    revokeMintAuthority: explorerTx(revokeSig, flags.rpc),
  },
});
console.log("\n✓ 01-mint-token complete. Publish the mint address + revoke tx publicly.");
