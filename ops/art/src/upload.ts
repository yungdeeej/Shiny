/**
 * upload.ts — Irys (Arweave) upload of images + metadata, behind env keys.
 *
 *   IRYS_KEY        base58 Solana secret key funding the uploads
 *   SOLANA_RPC_URL  rpc endpoint (default devnet)
 *
 * DRY-RUN is the DEFAULT: with no IRYS_KEY we skip with a clear message and the
 * manifest keeps its local file:// paths. With a key we upload each image, then
 * each metadata JSON (image field rewritten to the uploaded URI), and rewrite
 * the manifest's imageUri/metadataUri to the returned https URIs.
 *
 * The umi/irys calls below are marked UNVERIFIED — they follow the documented
 * umi-uploader-irys API but have not been exercised against a funded key here.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest } from "./manifest.js";

export interface UploadResult {
  uploaded: boolean;
  manifest: Manifest;
  note: string;
}

function localPathFromUri(uri: string): string {
  return uri.startsWith("file://") ? fileURLToPath(uri) : uri;
}

export async function uploadCollection(manifestPath: string): Promise<UploadResult> {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

  if (!process.env.IRYS_KEY) {
    const note =
      "DRY-RUN (no IRYS_KEY): skipped upload — manifest keeps local file:// paths. " +
      "Set IRYS_KEY (base58 Solana secret) + SOLANA_RPC_URL to publish to Arweave.";
    console.log(note);
    return { uploaded: false, manifest, note };
  }

  // ── UNVERIFIED — needs a funded key ──────────────────────────────────
  // The block below follows @metaplex-foundation/umi-uploader-irys' documented
  // surface. It is import-guarded so the dry-run path never loads umi.
  const { createUmi } = await import("@metaplex-foundation/umi-bundle-defaults");
  const { irysUploader } = await import("@metaplex-foundation/umi-uploader-irys");
  const umiCore = await import("@metaplex-foundation/umi");

  const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const umi = createUmi(rpc).use(irysUploader());

  // UNVERIFIED — key import shape; expects a base58 secret key.
  const bs58 = (await import("@metaplex-foundation/umi").then(() => umiCore)) as typeof umiCore;
  const secret = (bs58 as unknown as { base58: { serialize(s: string): Uint8Array } }).base58?.serialize?.(
    process.env.IRYS_KEY!,
  );
  if (secret) {
    const keypair = umi.eddsa.createKeypairFromSecretKey(secret);
    umi.use((umiCore as unknown as { keypairIdentity(k: unknown): never }).keypairIdentity(keypair));
  }

  for (const asset of manifest.assets) {
    const imgPath = localPathFromUri(asset.imageUri);
    const imgBytes = readFileSync(imgPath);
    // UNVERIFIED — umi file wrapper + uploader.upload return shape.
    const genericFile = (umiCore as unknown as {
      createGenericFile(b: Uint8Array, name: string, opts: { contentType: string }): unknown;
    }).createGenericFile(new Uint8Array(imgBytes), path.basename(imgPath), { contentType: "image/png" });
    const uploaded = (await umi.uploader.upload([genericFile as never])) as string[];
    const imageUri = uploaded[0] ?? asset.imageUri;
    asset.imageUri = imageUri;

    const metaPath = localPathFromUri(asset.metadataUri);
    const metadata = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    metadata.image = imageUri;
    (metadata.properties as { files: { uri: string }[] }).files[0]!.uri = imageUri;
    const metadataUri = (await umi.uploader.uploadJson(metadata)) as string;
    asset.metadataUri = metadataUri;
    console.log(`uploaded #${asset.index}: ${metadataUri}`);
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const note = `uploaded ${manifest.assets.length} assets to Arweave via Irys; manifest URIs rewritten.`;
  console.log(note);
  return { uploaded: true, manifest, note };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const mp = process.argv[2] ?? "out/collection/manifest.json";
  uploadCollection(mp).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
