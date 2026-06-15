/**
 * Worker-side chain config: resolve the signing-provider settings from env and
 * load keypairs from file paths (Solana CLI JSON byte-array format). The API
 * never sees these — only the worker signs.
 *
 * NEVER log the secret bytes. Loaded keypairs expose only their public key for
 * boot diagnostics.
 */
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import type { ChainProvider } from "@trash-wars/chain";
import { SolanaChainProvider, type SolanaProviderDeps } from "./solana.js";

export interface SolanaProviderConfig {
  rpcUrl: string;
  shinyMint: string;
  hotWallet: Keypair;
  mintAuthority: Keypair;
  /** mpl-core collection the characters mint into. Optional for SPL-only ops. */
  coreCollection: string | undefined;
  priorityFeeMicroLamports: number;
}

/** Parse a Solana CLI keypair file (JSON array of 64 bytes) into a Keypair. */
export function loadKeypairFile(path: string): Keypair {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    // Surface the path but never the contents.
    throw new Error(`failed to read keypair file at ${path}: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.some((n) => typeof n !== "number")) {
    throw new Error(`keypair file at ${path} is not a JSON byte array (Solana CLI format)`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
}

export interface ChainEnvShape {
  SOLANA_RPC_URL?: string;
  SHINY_MINT?: string;
  HOT_WALLET_KEYPAIR_PATH?: string;
  MINT_AUTHORITY_KEYPAIR_PATH?: string;
  CORE_COLLECTION_ADDRESS?: string;
  PRIORITY_FEE_MICROLAMPORTS?: string;
}

/**
 * True when the signing provider can be constructed (the three required inputs
 * are present). The mint-authority path defaults to the hot wallet if unset.
 */
export function hasSigningConfig(env: ChainEnvShape): boolean {
  return Boolean(env.HOT_WALLET_KEYPAIR_PATH && env.SHINY_MINT && env.SOLANA_RPC_URL);
}

/** Resolve the full config, loading keypairs. Throws a clear error if incomplete. */
export function resolveSolanaConfig(env: ChainEnvShape): SolanaProviderConfig {
  if (!env.HOT_WALLET_KEYPAIR_PATH || !env.SHINY_MINT || !env.SOLANA_RPC_URL) {
    throw new Error(
      "SolanaChainProvider needs HOT_WALLET_KEYPAIR_PATH + SHINY_MINT + SOLANA_RPC_URL set " +
        "(worker custody). Leave them unset to keep the stub/devnet-sim provider.",
    );
  }
  const hotWallet = loadKeypairFile(env.HOT_WALLET_KEYPAIR_PATH);
  // The mint authority defaults to the hot wallet when no separate key is given.
  const mintAuthority = env.MINT_AUTHORITY_KEYPAIR_PATH
    ? loadKeypairFile(env.MINT_AUTHORITY_KEYPAIR_PATH)
    : hotWallet;
  return {
    rpcUrl: env.SOLANA_RPC_URL,
    shinyMint: env.SHINY_MINT,
    hotWallet,
    mintAuthority,
    coreCollection: env.CORE_COLLECTION_ADDRESS || undefined,
    priorityFeeMicroLamports: env.PRIORITY_FEE_MICROLAMPORTS
      ? Number(env.PRIORITY_FEE_MICROLAMPORTS)
      : 50_000,
  };
}

/**
 * Factory: construct the real signing provider from env. Returns the provider
 * when the signing keys are configured, else throws a clear error (callers
 * decide whether to fall back to the stub/devnet-sim provider).
 */
export function createSolanaChainProvider(
  env: ChainEnvShape,
  deps?: SolanaProviderDeps,
): ChainProvider {
  const cfg = resolveSolanaConfig(env);
  return new SolanaChainProvider(cfg, deps);
}
