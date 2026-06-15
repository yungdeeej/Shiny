/**
 * Zod-validated environment. Beta-first defaults: with NO env vars set the API boots
 * fully self-contained (PGlite db, stub chain, in-process scheduler, guest auth on).
 */
import { z } from "zod";

const bigintString = z.string().regex(/^\d+$/);

const rawEnv = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().default("tw_session"),
  SESSION_TTL_DAYS: z.coerce.number().default(7),

  // Beta-first: defaults ON so `pnpm dev:api` works with zero configuration.
  BETA_MODE: z.string().default("1"),
  BETA_TIME_SCALE: z.coerce.number().positive().optional(),
  BETA_FAUCET_AMOUNT: bigintString.default("100000000000"), // 100k SHINY
  // v1.1: stub wallet holding (base units). 50k SHINY → beta users land Block —
  // the tier system shows without maxing out (free-tier maxStake unaffected).
  BETA_STUB_HOLDING: bigintString.default("50000000000"),

  SERVER_SEED_ENCRYPTION_KEY: z.string().default("trash-wars-dev-seed-key"),
  FREE_TIER_MIN_HOLDING: bigintString.default("10000000000"), // 10k SHINY

  WITHDRAWAL_FEE_BPS: z.coerce.number().int().default(500),
  MIN_WITHDRAWAL: bigintString.default("5000000000"), // 5k SHINY
  AUTO_PAY_DAILY_LIMIT: bigintString.default("250000000000"), // 250k SHINY
  GLOBAL_DAILY_WITHDRAWAL_CAP: bigintString.default("5000000000000"), // 5M SHINY

  DEPOSIT_ADDRESS: z.string().default("BETA-DEPOSIT"),
  HELIUS_WEBHOOK_SECRET: z.string().default(""),

  // Devnet chain provider (used when BETA_MODE=0; both required for real reads).
  SOLANA_RPC_URL: z.string().optional(),
  SHINY_MINT: z.string().optional(),
  MULTISIG_ATA: z.string().optional(),

  // Worker custody (the worker signs; the API never holds keys). All optional so
  // beta still boots with none set. Keypair files are Solana CLI JSON byte arrays.
  HOT_WALLET_KEYPAIR_PATH: z.string().optional(),
  MINT_AUTHORITY_KEYPAIR_PATH: z.string().optional(),
  CORE_COLLECTION_ADDRESS: z.string().optional(),
  CHARACTER_MANIFEST_PATH: z.string().optional(),
  PRIORITY_FEE_MICROLAMPORTS: z.coerce.number().int().default(50_000),
  DISCORD_ADMIN_WEBHOOK_URL: z.string().optional(),

  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  LOG_LEVEL: z.string().default("info"),
});

export interface Env {
  nodeEnv: string;
  isProd: boolean;
  databaseUrl: string | undefined;
  redisUrl: string | undefined;
  apiPort: number;
  webOrigin: string;
  sessionCookieName: string;
  sessionTtlMs: number;
  beta: boolean;
  /** 1 real second = `timeScale` game seconds. Default 60 in beta, 1 otherwise. */
  timeScale: number;
  betaFaucetAmount: bigint;
  betaStubHolding: bigint;
  serverSeedEncryptionKey: string;
  freeTierMinHolding: bigint;
  withdrawalFeeBps: number;
  minWithdrawal: bigint;
  autoPayDailyLimit: bigint;
  globalDailyWithdrawalCap: bigint;
  depositAddress: string;
  heliusWebhookSecret: string;
  solanaRpcUrl: string | undefined;
  shinyMint: string | undefined;
  multisigAta: string | undefined;
  hotWalletKeypairPath: string | undefined;
  mintAuthorityKeypairPath: string | undefined;
  coreCollectionAddress: string | undefined;
  characterManifestPath: string | undefined;
  priorityFeeMicroLamports: number;
  discordAdminWebhookUrl: string | undefined;
  rateLimitMax: number;
  logLevel: string;
}

export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  const parsed = rawEnv.parse({ ...process.env, ...overrides });
  const beta = parsed.BETA_MODE === "1" || parsed.BETA_MODE === "true";
  return {
    nodeEnv: parsed.NODE_ENV,
    isProd: parsed.NODE_ENV === "production",
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    apiPort: parsed.API_PORT,
    webOrigin: parsed.WEB_ORIGIN,
    sessionCookieName: parsed.SESSION_COOKIE_NAME,
    sessionTtlMs: parsed.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    beta,
    timeScale: parsed.BETA_TIME_SCALE ?? (beta ? 60 : 1),
    betaFaucetAmount: BigInt(parsed.BETA_FAUCET_AMOUNT),
    betaStubHolding: BigInt(parsed.BETA_STUB_HOLDING),
    serverSeedEncryptionKey: parsed.SERVER_SEED_ENCRYPTION_KEY,
    freeTierMinHolding: BigInt(parsed.FREE_TIER_MIN_HOLDING),
    withdrawalFeeBps: parsed.WITHDRAWAL_FEE_BPS,
    minWithdrawal: BigInt(parsed.MIN_WITHDRAWAL),
    autoPayDailyLimit: BigInt(parsed.AUTO_PAY_DAILY_LIMIT),
    globalDailyWithdrawalCap: BigInt(parsed.GLOBAL_DAILY_WITHDRAWAL_CAP),
    depositAddress: parsed.DEPOSIT_ADDRESS,
    heliusWebhookSecret: parsed.HELIUS_WEBHOOK_SECRET,
    solanaRpcUrl: parsed.SOLANA_RPC_URL,
    shinyMint: parsed.SHINY_MINT,
    multisigAta: parsed.MULTISIG_ATA,
    hotWalletKeypairPath: parsed.HOT_WALLET_KEYPAIR_PATH,
    mintAuthorityKeypairPath: parsed.MINT_AUTHORITY_KEYPAIR_PATH,
    coreCollectionAddress: parsed.CORE_COLLECTION_ADDRESS,
    characterManifestPath: parsed.CHARACTER_MANIFEST_PATH,
    priorityFeeMicroLamports: parsed.PRIORITY_FEE_MICROLAMPORTS,
    discordAdminWebhookUrl: parsed.DISCORD_ADMIN_WEBHOOK_URL,
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    logLevel: parsed.LOG_LEVEL,
  };
}
