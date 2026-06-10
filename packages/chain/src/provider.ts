import type { CharacterStats, Faction } from "@trash-wars/shared";
import { DevnetChainProvider } from "./devnet.js";

/**
 * Everything the game needs from Solana, behind one interface so the entire
 * stack runs in BETA_MODE with the stub, and swaps to the devnet/mainnet
 * provider without touching game code (docs 05/07).
 */
export interface ChainProvider {
  readonly cluster: "beta-stub" | "devnet" | "mainnet-beta";

  /** SPL balance of $SHINY held by a wallet (free-tier gate, doc 06). */
  getShinyHolding(address: string): Promise<bigint>;

  /** Send $SHINY from the hot wallet (withdrawal payout). Returns tx signature. */
  payWithdrawal(destAddress: string, amount: bigint): Promise<string>;

  /** On-chain reserves for proof-of-reserves (hot wallet + multisig ATAs). */
  getReserves(): Promise<{ hotWallet: bigint; multisig: bigint }>;

  /** Execute the weekly on-chain burn from custody (doc 09). */
  burnFromCustody(amount: bigint): Promise<string>;

  /** Metaplex Core: mint a character asset to a wallet (doc 07). */
  mintCharacter(args: {
    owner: string;
    name: string;
    faction: Faction;
    stats: CharacterStats;
    uri: string;
  }): Promise<{ assetId: string; signature: string }>;

  /** Toggle the PermanentFreezeDelegate (in-wallet staking). */
  setStaked(assetId: string, staked: boolean): Promise<string>;

  /** Permanent burn (character death). */
  burnAsset(assetId: string): Promise<string>;

  /** Sync the Attributes plugin after stat upgrades. */
  syncAttributes(assetId: string, stats: CharacterStats & { level: number }): Promise<string>;
}

/**
 * Beta-mode stub: deterministic, instant, no RPC. The default wallet holding is
 * configurable (BETA_STUB_HOLDING, base units; default 50k SHINY → beta users
 * land the Block tier and see the Street Cred system without maxing it), with a
 * per-address override map as the test hook for tier scenarios. "Tx signatures"
 * are tagged fakes that the UI renders as BETA badges instead of explorer links.
 */
export class StubChainProvider implements ChainProvider {
  readonly cluster = "beta-stub" as const;
  private seq = 0;
  /** Per-address holding overrides — test hook for Street Cred tier scenarios. */
  private readonly holdingOverrides = new Map<string, bigint>();

  constructor(private readonly defaultHolding: bigint = 50_000_000_000n) {}

  private sig(prefix: string): string {
    this.seq += 1;
    return `BETA-${prefix}-${Date.now().toString(36)}-${this.seq}`;
  }

  /** Test hook: pin a specific address to a holding (null clears the pin). */
  setHoldingOverride(address: string, holding: bigint | null): void {
    if (holding === null) this.holdingOverrides.delete(address);
    else this.holdingOverrides.set(address, holding);
  }

  async getShinyHolding(address: string): Promise<bigint> {
    return this.holdingOverrides.get(address) ?? this.defaultHolding;
  }

  async payWithdrawal(_dest: string, _amount: bigint): Promise<string> {
    return this.sig("WD");
  }

  async getReserves(): Promise<{ hotWallet: bigint; multisig: bigint }> {
    // Mirrors a healthy treasury so the proof-of-reserves page demos green.
    return { hotWallet: 50_000_000_000_000n, multisig: 700_000_000_000_000n };
  }

  async burnFromCustody(_amount: bigint): Promise<string> {
    return this.sig("BURN");
  }

  async mintCharacter(args: { name: string }): Promise<{ assetId: string; signature: string }> {
    return { assetId: `BETA-ASSET-${args.name}-${this.seq}`, signature: this.sig("MINT") };
  }

  async setStaked(): Promise<string> {
    return this.sig("STAKE");
  }

  async burnAsset(): Promise<string> {
    return this.sig("DEATH");
  }

  async syncAttributes(): Promise<string> {
    return this.sig("ATTR");
  }
}

/**
 * BETA_MODE=1 → stub. Otherwise, with SOLANA_RPC_URL + SHINY_MINT set, the
 * devnet provider (real reads over plain fetch JSON-RPC, simulated writes
 * until the worker brings the hot wallet). Mainnet custody (Metaplex Core
 * mints, real payouts) still lands in services/worker per docs 02/05/07.
 */
export function createChainProvider(env: {
  BETA_MODE?: string;
  BETA_STUB_HOLDING?: string;
  SOLANA_RPC_URL?: string;
  SHINY_MINT?: string;
  DEPOSIT_ADDRESS?: string;
  MULTISIG_ATA?: string;
}): ChainProvider {
  if (env.BETA_MODE === "1" || env.BETA_MODE === "true") {
    return new StubChainProvider(
      env.BETA_STUB_HOLDING !== undefined ? BigInt(env.BETA_STUB_HOLDING) : undefined,
    );
  }
  if (env.SOLANA_RPC_URL && env.SHINY_MINT) {
    return new DevnetChainProvider({
      rpcUrl: env.SOLANA_RPC_URL,
      shinyMint: env.SHINY_MINT,
      depositAta: env.DEPOSIT_ADDRESS,
      multisigAta: env.MULTISIG_ATA,
    });
  }
  throw new Error(
    "Non-beta ChainProvider needs config: set BETA_MODE=1 for the stub, or set SOLANA_RPC_URL + SHINY_MINT for the devnet provider (see docs/05, docs/07).",
  );
}
