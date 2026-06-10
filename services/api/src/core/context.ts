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
}

export async function buildContext(env: Env, opts: BuildContextOptions = {}): Promise<AppContext> {
  const log =
    opts.logger ??
    pino({ level: env.logLevel, base: undefined });
  const db = createDb({ connectionString: env.databaseUrl });
  await migrateDb(db);
  const ledger = new LedgerService(db);
  const accounts = await ledger.ensureSystemAccounts();
  const chain = createChainProvider({
    BETA_MODE: env.beta ? "1" : "0",
    SOLANA_RPC_URL: env.solanaRpcUrl,
    SHINY_MINT: env.shinyMint,
    DEPOSIT_ADDRESS: env.depositAddress,
    MULTISIG_ATA: env.multisigAta,
  });
  const bus = new GameBus();

  return {
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
}
