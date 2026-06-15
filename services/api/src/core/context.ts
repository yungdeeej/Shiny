/** Builds the per-process application context shared by API routes, ticks and the worker. */
import pino from "pino";
import { createDb, closeDb, migrateDb, LedgerService, type Db } from "@trash-wars/db";
import { createChainProvider, type ChainProvider } from "@trash-wars/chain";
import type { Env } from "./env.js";
import { GameBus } from "./bus.js";
import { makeClock, type GameClock } from "./time.js";
import type { SystemAccounts } from "./accounts.js";
import { AllowAllComplianceProvider, type ComplianceProvider } from "./compliance.js";

export interface AppContext {
  db: Db;
  ledger: LedgerService;
  chain: ChainProvider;
  accounts: SystemAccounts;
  env: Env;
  clock: GameClock;
  log: pino.Logger;
  bus: GameBus;
  compliance: ComplianceProvider;
  close(): Promise<void>;
}

export interface BuildContextOptions {
  compliance?: ComplianceProvider;
  logger?: pino.Logger;
  /**
   * Inject a ready-made ChainProvider, bypassing createChainProvider. The worker
   * uses this to wire the real SolanaChainProvider (it holds the signing keys);
   * the API never sets it, so its default (stub/devnet) is unchanged.
   */
  chainOverride?: ChainProvider;
}

export async function buildContext(env: Env, opts: BuildContextOptions = {}): Promise<AppContext> {
  const log =
    opts.logger ??
    pino({ level: env.logLevel, base: undefined });
  const db = createDb({ connectionString: env.databaseUrl });
  await migrateDb(db);
  const ledger = new LedgerService(db);
  const accounts = await ledger.ensureSystemAccounts();
  const chain =
    opts.chainOverride ??
    createChainProvider({
      BETA_MODE: env.beta ? "1" : "0",
      BETA_STUB_HOLDING: env.betaStubHolding.toString(),
      SOLANA_RPC_URL: env.solanaRpcUrl,
      SHINY_MINT: env.shinyMint,
      DEPOSIT_ADDRESS: env.depositAddress,
      MULTISIG_ATA: env.multisigAta,
    });
  const bus = new GameBus();

  const ctx: AppContext = {
    db,
    ledger,
    chain,
    accounts,
    env,
    clock: makeClock(env.timeScale),
    log,
    bus,
    compliance: opts.compliance ?? new AllowAllComplianceProvider(),
    async close() {
      bus.removeAll();
      await closeDb(db);
    },
  };

  // v1.1 (specs/02): Season Pass XP fan-out listens to every user event —
  // registered here so BOTH the API and the worker grant XP from their paths.
  const { registerPassListeners } = await import("./pass.js");
  registerPassListeners(ctx);

  return ctx;
}
