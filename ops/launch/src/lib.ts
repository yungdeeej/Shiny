/**
 * Shared helpers for $SHINY launch-ops scripts.
 *
 * Conventions enforced here (per docs/02):
 *  - Keypairs load only from a file path (--keypair or KEYPAIR_PATH env). Secret
 *    material is NEVER logged or written to manifests.
 *  - Every state-changing script is dry-run by default; --execute is required to send.
 *  - Manifests are written to ops/launch/out/ (gitignored) and refuse to overwrite
 *    unless explicitly allowed — this is the idempotency backstop on top of the
 *    chain-state checks each script performs.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createPrivateKey, sign as edSign, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export const SHINY_DECIMALS = 6;
export const SHINY_UNIT = 10n ** BigInt(SHINY_DECIMALS);
/** 1,000,000,000 $SHINY in base units. */
export const TOTAL_SUPPLY_BASE = 1_000_000_000n * SHINY_UNIT;

export const OUT_DIR = fileURLToPath(new URL("../out/", import.meta.url));

/* ── flags ─────────────────────────────────────────────────────────── */

export interface BaseFlags {
  rpc: string;
  keypairPath: string | undefined;
  execute: boolean;
}

type FlagValues = Record<string, string | boolean | undefined>;

/** Parse common flags plus script-specific ones. */
export function parseFlags(extra: ParseArgsConfig["options"]): FlagValues & BaseFlags {
  const { values } = parseArgs({
    options: {
      rpc: { type: "string" },
      keypair: { type: "string" },
      execute: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: true },
      ...extra,
    },
    allowPositionals: false,
  });
  const v = values as FlagValues;
  const rpc = (v.rpc as string | undefined) ?? process.env.RPC_URL;
  if (!rpc) fail("--rpc <url> (or RPC_URL env) is required");
  const base: BaseFlags = {
    rpc,
    keypairPath: (v.keypair as string | undefined) ?? process.env.KEYPAIR_PATH,
    // --execute wins; --dry-run is the (default-on) inverse.
    execute: v.execute === true,
  };
  return { ...v, ...base };
}

export function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/* ── connection / keypair ──────────────────────────────────────────── */

export function getConnection(rpc: string): Connection {
  return new Connection(rpc, "confirmed");
}

/** Load a keypair from a JSON byte-array file (solana-keygen format). Never logs secrets. */
export function loadKeypair(keypairPath: string | undefined): Keypair {
  if (!keypairPath) fail("--keypair <path> (or KEYPAIR_PATH env) is required");
  const raw = JSON.parse(readFileSync(keypairPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/* ── explorer links ────────────────────────────────────────────────── */

function clusterSuffix(rpc: string): string {
  if (rpc.includes("devnet")) return "?cluster=devnet";
  if (rpc.includes("testnet")) return "?cluster=testnet";
  if (rpc.includes("localhost") || rpc.includes("127.0.0.1"))
    return `?cluster=custom&customUrl=${encodeURIComponent(rpc)}`;
  return "";
}

export function explorerTx(sig: string, rpc: string): string {
  return `https://explorer.solana.com/tx/${sig}${clusterSuffix(rpc)}`;
}

export function explorerAddress(addr: string | PublicKey, rpc: string): string {
  return `https://explorer.solana.com/address/${addr.toString()}${clusterSuffix(rpc)}`;
}

/* ── retry ─────────────────────────────────────────────────────────── */

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 5,
  baseDelayMs = 1_000,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = baseDelayMs * 2 ** i;
      console.warn(`  retry ${i + 1}/${attempts} for ${label} in ${delay}ms: ${String(err)}`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── manifests ─────────────────────────────────────────────────────── */

export function manifestPath(name: string): string {
  return path.join(OUT_DIR, name);
}

export function manifestExists(name: string): boolean {
  return existsSync(manifestPath(name));
}

export function writeManifest(name: string, data: unknown, allowOverwrite = false): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const p = manifestPath(name);
  if (existsSync(p) && !allowOverwrite)
    fail(`manifest ${p} already exists — refusing to overwrite (double-run guard)`);
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
  console.log(`→ manifest written: ${p}`);
  return p;
}

export function readManifest<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(manifestPath(name), "utf8")) as T;
}

/**
 * Sign arbitrary JSON with the authority keypair (ed25519 over the UTF-8 manifest
 * body) so allocations manifests can be published with an authenticity proof.
 * Verify with: nacl.sign.detached.verify(bytes, bs58(sig), authorityPubkey).
 */
export function signManifest(keypair: Keypair, payload: unknown): { signer: string; signatureBase58: string } {
  const body = Buffer.from(JSON.stringify(payload));
  // Wrap the 32-byte ed25519 seed in a PKCS8 DER header for node:crypto.
  const seed = Buffer.from(keypair.secretKey.slice(0, 32));
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const sig = edSign(null, body, key);
  return { signer: keypair.publicKey.toBase58(), signatureBase58: bs58.encode(sig) };
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/* ── amounts ───────────────────────────────────────────────────────── */

/** Whole-token number/string (max 6 dp) → base units. */
export function toBaseUnits(whole: number | string): bigint {
  const s = String(whole);
  const [int = "0", frac = ""] = s.split(".");
  if (frac.length > SHINY_DECIMALS) fail(`amount ${s} has more than ${SHINY_DECIMALS} decimals`);
  return BigInt(int) * SHINY_UNIT + BigInt((frac + "000000").slice(0, SHINY_DECIMALS));
}

export function formatShiny(base: bigint): string {
  const whole = base / SHINY_UNIT;
  const frac = base % SHINY_UNIT;
  const fracStr = frac === 0n ? "" : `.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
  return `${whole.toLocaleString("en-US")}${fracStr}`;
}

/* ── dry-run banner ────────────────────────────────────────────────── */

export function banner(script: string, flags: BaseFlags): void {
  console.log(`── ${script} ──`);
  console.log(`   rpc: ${flags.rpc}`);
  console.log(`   mode: ${flags.execute ? "EXECUTE (will send transactions)" : "DRY RUN (default — pass --execute to send)"}`);
}
