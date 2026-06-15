/**
 * Construction smoke test: generate a throwaway Keypair, write its bytes to a
 * tmp file (Solana CLI JSON byte-array format), and construct the provider.
 * Does NOT send anything — only verifies wiring + keypair loading.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { loadKeypairFile, resolveSolanaConfig, createSolanaChainProvider, hasSigningConfig } from "../chain/config.js";

const dir = mkdtempSync(join(tmpdir(), "tw-keypair-"));
const hotPath = join(dir, "hot.json");
const hot = Keypair.generate();
writeFileSync(hotPath, JSON.stringify(Array.from(hot.secretKey)));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const env = {
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
  SHINY_MINT: "So11111111111111111111111111111111111111112",
  HOT_WALLET_KEYPAIR_PATH: hotPath,
  PRIORITY_FEE_MICROLAMPORTS: "75000",
};

describe("SolanaChainProvider construction", () => {
  it("loads a Solana CLI keypair file into the matching public key", () => {
    const kp = loadKeypairFile(hotPath);
    expect(kp.publicKey.toBase58()).toBe(hot.publicKey.toBase58());
  });

  it("rejects a non-byte-array keypair file", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ not: "an array" }));
    expect(() => loadKeypairFile(bad)).toThrow(/byte array/);
  });

  it("hasSigningConfig is true only with all three inputs", () => {
    expect(hasSigningConfig(env)).toBe(true);
    expect(hasSigningConfig({ ...env, HOT_WALLET_KEYPAIR_PATH: undefined })).toBe(false);
  });

  it("resolves config (mint authority defaults to the hot wallet)", () => {
    const cfg = resolveSolanaConfig(env);
    expect(cfg.priorityFeeMicroLamports).toBe(75000);
    expect(cfg.mintAuthority.publicKey.toBase58()).toBe(hot.publicKey.toBase58());
    expect(new PublicKey(cfg.shinyMint).toBase58()).toBe(env.SHINY_MINT);
  });

  it("constructs the provider without sending anything", () => {
    const provider = createSolanaChainProvider(env);
    expect(provider.cluster).toBe("devnet");
    expect(typeof provider.payWithdrawal).toBe("function");
    expect(typeof provider.mintCharacter).toBe("function");
  });

  it("throws a clear error when keys are missing", () => {
    expect(() => resolveSolanaConfig({ SHINY_MINT: env.SHINY_MINT })).toThrow(/HOT_WALLET_KEYPAIR_PATH/);
  });
});
