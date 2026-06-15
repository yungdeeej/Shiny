/**
 * Worker test harness: an in-memory PGlite AppContext with a FAKE chain provider
 * (tests CANNOT hit a live chain). Mirrors the API test harness but builds the
 * context directly (no Fastify) since the worker exercises ctx + jobs.
 */
import pino from "pino";
import { loadEnv, buildContext, bootstrap, type AppContext } from "@trash-wars/api/core";
import type { ChainProvider } from "@trash-wars/chain";
import type { CharacterStats, Faction } from "@trash-wars/shared";

/** A fully scriptable fake provider — records calls, returns canned sigs/ids. */
export class FakeChainProvider implements ChainProvider {
  readonly cluster = "devnet" as const;
  calls: Array<{ op: string; args: unknown }> = [];
  /** When set, the next matching op throws (one-shot per op name unless sticky). */
  failOps = new Set<string>();
  reserves = { hotWallet: 10n ** 18n, multisig: 0n };
  private seq = 0;

  private rec(op: string, args: unknown): void {
    this.calls.push({ op, args });
    if (this.failOps.has(op)) throw new Error(`fake chain: ${op} forced failure`);
  }

  async getShinyHolding(): Promise<bigint> {
    return 0n;
  }
  async getReserves(): Promise<{ hotWallet: bigint; multisig: bigint }> {
    return this.reserves;
  }
  async payWithdrawal(dest: string, amount: bigint): Promise<string> {
    this.rec("payWithdrawal", { dest, amount });
    return `FAKE-WD-${++this.seq}`;
  }
  async burnFromCustody(amount: bigint): Promise<string> {
    this.rec("burnFromCustody", { amount });
    return `FAKE-BURN-${++this.seq}`;
  }
  async mintCharacter(args: {
    owner: string;
    name: string;
    faction: Faction;
    stats: CharacterStats;
    uri: string;
  }): Promise<{ assetId: string; signature: string }> {
    this.rec("mintCharacter", args);
    return { assetId: `FAKE-ASSET-${++this.seq}`, signature: `FAKE-MINT-${this.seq}` };
  }
  async setStaked(assetId: string, staked: boolean): Promise<string> {
    this.rec("setStaked", { assetId, staked });
    return `FAKE-STAKE-${++this.seq}`;
  }
  async burnAsset(assetId: string): Promise<string> {
    this.rec("burnAsset", { assetId });
    return `FAKE-DEATH-${++this.seq}`;
  }
  async syncAttributes(assetId: string, stats: CharacterStats & { level: number }): Promise<string> {
    this.rec("syncAttributes", { assetId, stats });
    return `FAKE-ATTR-${++this.seq}`;
  }

  countOf(op: string): number {
    return this.calls.filter((c) => c.op === op).length;
  }
}

export async function buildWorkerTestContext(
  chain: ChainProvider,
): Promise<AppContext> {
  process.env.PGLITE_DIR = "memory://";
  const env = loadEnv({
    BETA_MODE: "0",
    DATABASE_URL: undefined,
    REDIS_URL: undefined,
    LOG_LEVEL: "silent",
    SERVER_SEED_ENCRYPTION_KEY: "worker-test-seed-key",
    // A real SHINY_MINT-shaped value so the non-beta path is exercised.
    SOLANA_RPC_URL: "https://api.devnet.solana.com",
    SHINY_MINT: "So11111111111111111111111111111111111111112",
  });
  const log = pino({ level: "silent" });
  return buildContext(env, { chainOverride: chain, logger: log }).then(async (ctx) => {
    await bootstrap(ctx);
    return ctx;
  });
}

/** Convenience: total of all ledger deltas (conservation invariant → 0). */
export async function ledgerTotal(ctx: AppContext): Promise<bigint> {
  const { ledgerEntries } = await import("@trash-wars/db");
  const { sql } = await import("../orm.js");
  const rows = await ctx.db
    .select({ v: sql<string>`coalesce(sum(${ledgerEntries.delta}), 0)::text` })
    .from(ledgerEntries);
  return BigInt(rows[0]?.v ?? "0");
}
