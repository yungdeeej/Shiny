import type { CharacterStats, Faction } from "@trash-wars/shared";
import type { ChainProvider } from "./provider.js";
import { isValidSolanaAddress } from "./siws.js";

/**
 * Devnet ChainProvider — REAL READS over plain JSON-RPC `fetch` (no
 * @solana/web3.js: this package stays light and isomorphic).
 *
 * Reads:
 *   - getShinyHolding → getTokenAccountsByOwner(owner, { mint }, jsonParsed)
 *   - getReserves     → getTokenAccountBalance on the hot-wallet / multisig ATAs
 *
 * Writes: until a signing key exists (lands with the worker), every write
 * returns a clearly-tagged `DEVNET-SIM-*` fake signature exactly like the beta
 * stub, so the game stays fully playable on devnet before the hot wallet is up.
 */

export interface DevnetChainProviderOptions {
  rpcUrl: string;
  shinyMint: string;
  /** Hot-wallet $SHINY ATA (proof-of-reserves). Invalid/unset → 0n. */
  depositAta?: string;
  /** Multisig $SHINY ATA (proof-of-reserves). Invalid/unset → 0n. */
  multisigAta?: string;
  fetchImpl?: typeof fetch;
  /** Holdings cache TTL — the free-tier gate hits this per mission start. */
  cacheTtlMs?: number;
  /** Base backoff between RPC retries (tests set this to 0/1ms). */
  retryBackoffMs?: number;
  logger?: { warn: (msg: string) => void };
  now?: () => number;
}

interface JsonRpcEnvelope {
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface ParsedTokenAccount {
  account?: {
    data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } };
  };
}

const RPC_TRIES = 3;

export class DevnetChainProvider implements ChainProvider {
  readonly cluster = "devnet" as const;

  private readonly rpcUrl: string;
  private readonly shinyMint: string;
  private readonly depositAta: string | undefined;
  private readonly multisigAta: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly retryBackoffMs: number;
  private readonly log: { warn: (msg: string) => void };
  private readonly now: () => number;

  private readonly holdingCache = new Map<string, { value: bigint; at: number }>();
  private warnedSimWrites = false;
  private warnedFailClosed = false;
  private seq = 0;
  private rpcSeq = 0;

  constructor(opts: DevnetChainProviderOptions) {
    this.rpcUrl = opts.rpcUrl;
    this.shinyMint = opts.shinyMint;
    // "BETA-DEPOSIT"-style placeholders are treated as unset.
    this.depositAta = opts.depositAta && isValidSolanaAddress(opts.depositAta) ? opts.depositAta : undefined;
    this.multisigAta = opts.multisigAta && isValidSolanaAddress(opts.multisigAta) ? opts.multisigAta : undefined;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.cacheTtlMs = opts.cacheTtlMs ?? 5 * 60 * 1000;
    this.retryBackoffMs = opts.retryBackoffMs ?? 250;
    this.log = opts.logger ?? { warn: (msg) => console.warn(msg) };
    this.now = opts.now ?? (() => Date.now());
  }

  /* ── JSON-RPC plumbing ─────────────────────────────────────────── */

  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < RPC_TRIES; attempt++) {
      if (attempt > 0 && this.retryBackoffMs > 0) {
        await new Promise((r) => setTimeout(r, this.retryBackoffMs * 2 ** (attempt - 1)));
      }
      try {
        const res = await this.fetchImpl(this.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.rpcSeq, method, params }),
        });
        if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
        const body = (await res.json()) as JsonRpcEnvelope;
        if (body.error) throw new Error(`RPC ${method} error: ${body.error.message ?? body.error.code}`);
        return body.result;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /* ── Reads ─────────────────────────────────────────────────────── */

  async getShinyHolding(address: string): Promise<bigint> {
    const cached = this.holdingCache.get(address);
    if (cached && this.now() - cached.at < this.cacheTtlMs) return cached.value;

    try {
      const result = (await this.rpc("getTokenAccountsByOwner", [
        address,
        { mint: this.shinyMint },
        { encoding: "jsonParsed" },
      ])) as { value?: ParsedTokenAccount[] } | null;

      let total = 0n;
      for (const acc of result?.value ?? []) {
        const amount = acc.account?.data?.parsed?.info?.tokenAmount?.amount;
        if (amount !== undefined) total += BigInt(amount);
      }
      this.holdingCache.set(address, { value: total, at: this.now() });
      return total;
    } catch (err) {
      // Fail closed for the free-tier gate: no proof of holding → 0n.
      if (!this.warnedFailClosed) {
        this.warnedFailClosed = true;
        this.log.warn(
          `DevnetChainProvider: getShinyHolding RPC failed after ${RPC_TRIES} tries — failing closed (0n). ${String(err)}`,
        );
      }
      return 0n;
    }
  }

  async getReserves(): Promise<{ hotWallet: bigint; multisig: bigint }> {
    const [hotWallet, multisig] = await Promise.all([
      this.ataBalance(this.depositAta),
      this.ataBalance(this.multisigAta),
    ]);
    return { hotWallet, multisig };
  }

  private async ataBalance(ata: string | undefined): Promise<bigint> {
    if (!ata) return 0n;
    // No try/catch: proof-of-reserves must throw on persistent RPC failure
    // rather than report a fake healthy treasury.
    const result = (await this.rpc("getTokenAccountBalance", [ata])) as {
      value?: { amount?: string };
    } | null;
    return BigInt(result?.value?.amount ?? "0");
  }

  /* ── Writes — simulated until the hot wallet/worker lands ─────── */

  private sig(prefix: string): string {
    if (!this.warnedSimWrites) {
      this.warnedSimWrites = true;
      this.log.warn(
        "DevnetChainProvider: no signing key configured — write operations return DEVNET-SIM-* fake signatures (real signing lands with the worker).",
      );
    }
    this.seq += 1;
    return `DEVNET-SIM-${prefix}-${Date.now().toString(36)}-${this.seq}`;
  }

  async payWithdrawal(_dest: string, _amount: bigint): Promise<string> {
    return this.sig("WD");
  }

  async burnFromCustody(_amount: bigint): Promise<string> {
    return this.sig("BURN");
  }

  async mintCharacter(args: {
    owner: string;
    name: string;
    faction: Faction;
    stats: CharacterStats;
    uri: string;
  }): Promise<{ assetId: string; signature: string }> {
    const signature = this.sig("MINT");
    return { assetId: `DEVNET-SIM-ASSET-${args.name}-${this.seq}`, signature };
  }

  async setStaked(_assetId: string, _staked: boolean): Promise<string> {
    return this.sig("STAKE");
  }

  async burnAsset(_assetId: string): Promise<string> {
    return this.sig("DEATH");
  }

  async syncAttributes(_assetId: string, _stats: CharacterStats & { level: number }): Promise<string> {
    return this.sig("ATTR");
  }
}
