import type { CharacterStats, Faction } from "@trash-wars/shared";

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
 * Beta-mode stub: deterministic, instant, no RPC. Holdings are seeded huge so
 * free-tier gates pass during the playtest; "tx signatures" are tagged fakes
 * that the UI renders as BETA badges instead of explorer links.
 */
export class StubChainProvider implements ChainProvider {
  readonly cluster = "beta-stub" as const;
  private seq = 0;

  private sig(prefix: string): string {
    this.seq += 1;
    return `BETA-${prefix}-${Date.now().toString(36)}-${this.seq}`;
  }

  async getShinyHolding(): Promise<bigint> {
    return 1_000_000_000_000n; // 1M SHINY — free tier always open in beta
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
 * Devnet/mainnet provider lands in services/worker with @solana/web3.js +
 * @metaplex-foundation/mpl-core once keys/RPC exist (docs 02/05/07 runbooks).
 * Keeping heavy Solana deps out of this package keeps the web bundle clean.
 */
export function createChainProvider(env: { BETA_MODE?: string }): ChainProvider {
  if (env.BETA_MODE === "1" || env.BETA_MODE === "true") return new StubChainProvider();
  throw new Error(
    "Non-beta ChainProvider not wired yet: set BETA_MODE=1, or implement SolanaChainProvider (see docs/05, docs/07).",
  );
}
