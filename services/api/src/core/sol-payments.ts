/**
 * SOL payment rail (doc 11 + doc 13 §4): "SOL buys flex + convenience".
 *
 * The server builds an UNSIGNED SOL transfer to the revenue wallet carrying a
 * unique reference in a Memo instruction; the player's wallet signs + sends;
 * the server then verifies the confirmed (finalized) transaction — exact
 * lamports, correct destination, correct payer, matching memo — before granting.
 * Idempotency is arbitered by the sol_payments.tx_sig UNIQUE constraint.
 *
 * This rail NEVER touches the $SHINY double-entry ledger. All amounts are
 * integer lamports — no floats in the lamports path (the SOL price is converted
 * to integer lamports up-front and only integers flow from there).
 */
import { randomBytes } from "node:crypto";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { z } from "zod";
import { PASS, LAMPORTS_PER_SOL, type SolProductKind } from "@trash-wars/shared";
import { cosmeticItems } from "@trash-wars/db";
import { eq } from "./orm.js";
import type { Db } from "@trash-wars/db";
import { badRequest, notFound, notImplemented } from "./errors.js";

/** SPL Memo program v2 — carries the unique reference string on the transfer. */
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** How long a built intent's blockhash is treated as valid (advisory expiry). */
const INTENT_TTL_MS = 90_000;

const rawSolEnv = z.object({
  // Presence + validity is checked by new PublicKey() below (an invalid value
  // simply disables the rail), so no length/format constraint here.
  REVENUE_WALLET: z.string().optional(),
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
});

export interface SolPaymentsConfig {
  enabled: boolean;
  /** base58 destination pubkey; undefined when the rail is not configured. */
  revenueWallet: string | undefined;
  rpcUrl: string;
}

/**
 * Read the SOL-rail config from the environment. env.ts is owned by another
 * agent, so the rail reads its own vars directly via process.env with a local
 * zod parse. `enabled` is derived from REVENUE_WALLET being present + valid.
 */
export function loadSolConfig(
  overrides: Record<string, string | undefined> = {},
): SolPaymentsConfig {
  const parsed = rawSolEnv.parse({
    REVENUE_WALLET: overrides.REVENUE_WALLET ?? process.env.REVENUE_WALLET,
    SOLANA_RPC_URL: overrides.SOLANA_RPC_URL ?? process.env.SOLANA_RPC_URL ?? undefined,
  });
  let revenueWallet: string | undefined;
  if (parsed.REVENUE_WALLET) {
    // Validate it is a real base58 pubkey; an invalid wallet disables the rail.
    try {
      new PublicKey(parsed.REVENUE_WALLET);
      revenueWallet = parsed.REVENUE_WALLET;
    } catch {
      revenueWallet = undefined;
    }
  }
  return {
    enabled: revenueWallet !== undefined,
    revenueWallet,
    rpcUrl: parsed.SOLANA_RPC_URL,
  };
}

/* ── injectable RPC seam ─────────────────────────────────────────────
   Tests inject a fake RPC so they never hit the network. Production passes
   nothing and a real web3.js Connection is constructed from the config. */

export interface SolRpc {
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  getTransaction(
    sig: string,
    opts: { commitment: "finalized"; maxSupportedTransactionVersion: number },
  ): Promise<RpcTransaction | null>;
}

/** The narrow slice of a getTransaction response the verifier inspects. */
export interface RpcTransaction {
  meta: { err: unknown | null } | null;
  transaction: {
    message: {
      /** All account keys referenced by the tx, in index order. */
      accountKeys: string[];
      instructions: Array<{
        /** Index into accountKeys of the invoked program. */
        programIdIndex: number;
        /** Indexes into accountKeys of the instruction accounts. */
        accounts: number[];
        /** base58-encoded instruction data. */
        data: string;
      }>;
    };
  };
}

/** Build a real RPC adapter around a web3.js Connection. */
export function connectionRpc(rpcUrl: string): SolRpc {
  const conn = new Connection(rpcUrl, "finalized");
  return {
    getLatestBlockhash: () => conn.getLatestBlockhash("finalized"),
    async getTransaction(sig, opts) {
      const tx = await conn.getTransaction(sig, opts);
      if (!tx) return null;
      const msg = tx.transaction.message;
      const keys = msg.staticAccountKeys.map((k) => k.toBase58());
      const compiled = msg.compiledInstructions.map((ix) => ({
        programIdIndex: ix.programIdIndex,
        accounts: Array.from(ix.accountKeyIndexes),
        // compiled instruction data is a Uint8Array → base58 like the JSON-RPC shape.
        data: bs58Encode(ix.data),
      }));
      return {
        meta: { err: tx.meta?.err ?? null },
        transaction: { message: { accountKeys: keys, instructions: compiled } },
      };
    },
  };
}

/* ── pricing ─────────────────────────────────────────────────────────
   The SOL price (a small decimal like 0.3) is converted ONCE to integer
   lamports here; only integers flow downstream. */

export function solToLamports(sol: number): number {
  // Round to the nearest lamport to avoid float drift (0.3 * 1e9 etc.).
  return Math.round(sol * LAMPORTS_PER_SOL);
}

export interface PriceResult {
  product: SolProductKind;
  ref: string;
  priceSol: number;
  lamports: number;
}

/**
 * Resolve the lamport price for a payable. season_pass → 0.3 SOL (PASS.priceSol);
 * cosmetic → the item's price_sol (rejected if the item is not a SOL-priced item).
 */
export async function priceLamports(
  db: Db,
  product: SolProductKind,
  ref: string,
): Promise<PriceResult> {
  if (product === "season_pass") {
    const priceSol = PASS.priceSol;
    return { product, ref: "premium", priceSol, lamports: solToLamports(priceSol) };
  }
  // cosmetic
  const rows = await db
    .select({ slug: cosmeticItems.slug, priceSol: cosmeticItems.priceSol })
    .from(cosmeticItems)
    .where(eq(cosmeticItems.slug, ref))
    .limit(1);
  const item = rows[0];
  if (!item) throw notFound("item not found");
  if (item.priceSol === null || item.priceSol === undefined) {
    throw badRequest("NOT_SOL_PRICED", "item is not purchasable on the SOL rail");
  }
  return { product, ref: item.slug, priceSol: item.priceSol, lamports: solToLamports(item.priceSol) };
}

/* ── build ───────────────────────────────────────────────────────────── */

export interface BuildSolPaymentInput {
  payer: string;
  product: SolProductKind;
  ref: string;
  lamports: number;
  revenueWallet: string;
  rpc: SolRpc;
}

export interface BuiltSolPayment {
  reference: string;
  memo: string;
  serializedTx: string;
  expiresAt: string;
}

/** A fresh 16-byte hex reference, unique per intent, echoed in the memo. */
export function newReference(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Build an UNSIGNED VersionedTransaction: a SystemProgram.transfer(payer →
 * revenueWallet, lamports) plus a Memo instruction carrying `reference`.
 */
export async function buildSolPayment(input: BuildSolPaymentInput): Promise<BuiltSolPayment> {
  const payer = new PublicKey(input.payer);
  const dest = new PublicKey(input.revenueWallet);
  const reference = newReference();
  const memo = `tw:${input.product}:${input.ref}:${reference}`;

  const { blockhash } = await input.rpc.getLatestBlockhash();

  const transfer = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: dest,
    lamports: input.lamports,
  });
  const memoIx = new TransactionInstruction({
    keys: [],
    programId: new PublicKey(MEMO_PROGRAM_ID),
    data: Buffer.from(memo, "utf8"),
  });

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [transfer, memoIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);

  return {
    reference,
    memo,
    serializedTx: Buffer.from(tx.serialize()).toString("base64"),
    expiresAt: new Date(Date.now() + INTENT_TTL_MS).toISOString(),
  };
}

/* ── verify ──────────────────────────────────────────────────────────── */

export interface VerifySolPaymentInput {
  txSig: string;
  reference: string;
  expectedPayer: string;
  expectedLamports: number;
  revenueWallet: string;
  rpc: SolRpc;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  /** The matched memo string (present on success) — carries product:ref:reference. */
  memo?: string;
}

/** Parse the `tw:{product}:{ref}:{reference}` memo the rail writes on build. */
export function parseMemo(
  memo: string,
): { product: SolProductKind; ref: string; reference: string } | null {
  const parts = memo.split(":");
  if (parts.length < 4 || parts[0] !== "tw") return null;
  const product = parts[1];
  if (product !== "season_pass" && product !== "cosmetic") return null;
  // ref may itself contain no colons (slugs are kebab-case); reference is last.
  const reference = parts[parts.length - 1]!;
  const ref = parts.slice(2, parts.length - 1).join(":");
  return { product, ref, reference };
}

const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();

/**
 * Verify a confirmed SOL payment. Strict: the tx must exist, be error-free,
 * contain a System transfer of EXACTLY expectedLamports from expectedPayer to
 * revenueWallet, and carry the reference in a Memo instruction. Any deviation
 * (wrong amount/payer/dest, missing memo, tx error, unknown sig) → ok:false.
 */
export async function verifySolPayment(input: VerifySolPaymentInput): Promise<VerifyResult> {
  let tx: RpcTransaction | null;
  try {
    tx = await input.rpc.getTransaction(input.txSig, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
  } catch {
    return { ok: false, reason: "rpc_error" };
  }
  if (!tx) return { ok: false, reason: "tx_not_found" };
  if (tx.meta?.err != null) return { ok: false, reason: "tx_failed" };

  const keys = tx.transaction.message.accountKeys;
  const ixs = tx.transaction.message.instructions;

  // 1) System transfer of exactly expectedLamports, payer → revenueWallet.
  let transferOk = false;
  for (const ix of ixs) {
    const programId = keys[ix.programIdIndex];
    if (programId !== SYSTEM_PROGRAM_ID) continue;
    let data: Buffer;
    try {
      data = bs58Decode(ix.data);
    } catch {
      continue;
    }
    // SystemInstruction::Transfer = variant 2 (u32 LE) + lamports (u64 LE) = 12 bytes.
    if (data.length < 12) continue;
    if (data.readUInt32LE(0) !== 2) continue;
    const lamports = data.readBigUInt64LE(4);
    const fromIdx = ix.accounts[0];
    const toIdx = ix.accounts[1];
    if (fromIdx === undefined || toIdx === undefined) continue;
    const from = keys[fromIdx];
    const to = keys[toIdx];
    if (from !== input.expectedPayer) continue;
    if (to !== input.revenueWallet) continue;
    if (lamports !== BigInt(input.expectedLamports)) {
      return { ok: false, reason: "wrong_amount" };
    }
    transferOk = true;
    break;
  }
  if (!transferOk) {
    // Distinguish a present-but-wrong-payer/dest transfer from a missing one is
    // not needed — any of these means the payment binding wasn't honored.
    return { ok: false, reason: "no_matching_transfer" };
  }

  // 2) Memo instruction carrying the reference.
  let matchedMemo: string | undefined;
  for (const ix of ixs) {
    if (keys[ix.programIdIndex] !== MEMO_PROGRAM_ID) continue;
    let memo: string;
    try {
      memo = bs58Decode(ix.data).toString("utf8");
    } catch {
      continue;
    }
    if (memo.includes(input.reference)) {
      matchedMemo = memo;
      break;
    }
  }
  if (!matchedMemo) return { ok: false, reason: "missing_memo" };

  return { ok: true, memo: matchedMemo };
}

/** The rail is disabled cleanly when REVENUE_WALLET is absent (beta). */
export function railDisabled(): never {
  throw notImplemented("SOL rail not configured in beta");
}

/**
 * Read the product+ref a confirmed tx was for, straight from its memo. Used by
 * the confirm routes to re-derive (and re-price) the payable server-side before
 * the strict verifySolPayment binding — never trusting client-supplied product.
 */
export async function readMemoRef(
  rpc: SolRpc,
  txSig: string,
): Promise<{ product: SolProductKind; ref: string; reference: string } | null> {
  let tx: RpcTransaction | null;
  try {
    tx = await rpc.getTransaction(txSig, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
  } catch {
    return null;
  }
  if (!tx) return null;
  const keys = tx.transaction.message.accountKeys;
  for (const ix of tx.transaction.message.instructions) {
    if (keys[ix.programIdIndex] !== MEMO_PROGRAM_ID) continue;
    try {
      return parseMemo(bs58Decode(ix.data).toString("utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

/* ── runtime registry (config + injectable RPC seam) ──────────────────
   env.ts and context.ts are owned by other agents, so the rail keeps its own
   tiny runtime holder. Modules read it per-request via getSolRail(); tests call
   configureSolRail() to set REVENUE_WALLET and inject a fake RPC so they never
   touch the network. On first access in production it reads process.env. */

export interface SolRail {
  config: SolPaymentsConfig;
  rpc: SolRpc;
}

let railSingleton: SolRail | undefined;

/**
 * Configure the rail explicitly (tests / boot). `rpc` overrides the RPC seam;
 * when omitted a real web3.js Connection is used. Passing nothing for env reads
 * process.env. Returns the resolved rail.
 */
export function configureSolRail(opts: {
  env?: Record<string, string | undefined>;
  rpc?: SolRpc;
} = {}): SolRail {
  const config = loadSolConfig(opts.env ?? {});
  const rpc = opts.rpc ?? connectionRpc(config.rpcUrl);
  railSingleton = { config, rpc };
  return railSingleton;
}

/** Current rail, lazily reading process.env on first access. */
export function getSolRail(): SolRail {
  if (!railSingleton) railSingleton = configureSolRail();
  return railSingleton;
}

/** Test/teardown hook: forget the configured rail so the next call re-reads env. */
export function resetSolRail(): void {
  railSingleton = undefined;
}

/* ── base58 (no extra dep: web3.js bundles bs58 but we keep a tiny local impl
   so instruction data round-trips through the JSON-RPC string shape) ─────── */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP: Record<string, number> = {};
for (let i = 0; i < B58.length; i++) B58_MAP[B58[i]!] = i;

export function bs58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = "";
  for (let k = 0; bytes[k] === 0 && k < bytes.length - 1; k++) str += "1";
  for (let q = digits.length - 1; q >= 0; q--) str += B58[digits[q]!];
  return str;
}

export function bs58Decode(str: string): Buffer {
  if (str.length === 0) return Buffer.alloc(0);
  const bytes: number[] = [0];
  for (const ch of str) {
    const value = B58_MAP[ch];
    if (value === undefined) throw new Error("invalid base58 char");
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leading = 0;
  for (let k = 0; k < str.length - 1 && str[k] === "1"; k++) leading++;
  return Buffer.from([...new Array(leading).fill(0), ...bytes.reverse()]);
}
