/**
 * Trash Wars worker — BullMQ shell around the SAME tick functions the API's
 * in-process scheduler runs, PLUS the on-chain signing path (the API never
 * signs). Requires REDIS_URL. When the custody keys are configured the worker
 * injects the real SolanaChainProvider so withdrawal payouts, the weekly burn
 * and character mints sign for real; otherwise it keeps today's stub/devnet-sim
 * behavior and warns once (never crashes the beta worker).
 */
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import {
  TICKS,
  tickIntervalsMs,
  loadEnv,
  buildContext,
  bootstrap,
  type AppContext,
  type TickName,
} from "@trash-wars/api/core";
import { auditLog } from "@trash-wars/db";
import type { ChainProvider } from "@trash-wars/chain";
import { hasSigningConfig, createSolanaChainProvider } from "./chain/config.js";
import { loadManifest, type Manifest } from "./chain/manifest.js";
import { fulfillMintOrder } from "./jobs/mint-character.js";
import { runWithdrawalPayouts } from "./jobs/withdrawals.js";
import { executeWeeklyBurn } from "./jobs/weekly-burn.js";

const QUEUE = "trash-wars-ticks";
const MINT_QUEUE = "mint-character";
const HEARTBEAT_JOB = "heartbeat";
const WEEKLY_BURN_JOB = "execute-weekly-burn";

function chainEnv() {
  return {
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    SHINY_MINT: process.env.SHINY_MINT,
    HOT_WALLET_KEYPAIR_PATH: process.env.HOT_WALLET_KEYPAIR_PATH,
    MINT_AUTHORITY_KEYPAIR_PATH: process.env.MINT_AUTHORITY_KEYPAIR_PATH,
    CORE_COLLECTION_ADDRESS: process.env.CORE_COLLECTION_ADDRESS,
    PRIORITY_FEE_MICROLAMPORTS: process.env.PRIORITY_FEE_MICROLAMPORTS,
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.redisUrl) {
    console.error(
      "worker: REDIS_URL is not set. In beta the API runs its own in-process scheduler — " +
        "this worker only makes sense with Redis. Exiting.",
    );
    process.exit(1);
  }

  // Build the real signing provider iff custody keys are configured. On any
  // construction error, warn and fall back — never crash the worker.
  let chainOverride: ChainProvider | undefined;
  if (hasSigningConfig(chainEnv())) {
    try {
      chainOverride = createSolanaChainProvider(chainEnv());
    } catch (err) {
      console.error(
        `worker: signing keys present but provider construction failed — falling back to default provider. ${String(err)}`,
      );
    }
  }

  const ctx = await buildContext(env, { chainOverride });
  await bootstrap(ctx);
  ctx.log.info(
    { provider: ctx.chain.cluster, signing: Boolean(chainOverride) },
    chainOverride
      ? "worker context ready — REAL signing provider active"
      : "worker context ready — stub/devnet-sim provider (no custody keys)",
  );

  // Load the character art manifest once (optional — placeholder mints if absent).
  let manifest: Manifest | undefined;
  if (env.characterManifestPath) {
    try {
      manifest = await loadManifest(env.characterManifestPath);
      ctx.log.info(
        { assets: manifest.assets.length, collection: manifest.collection.name },
        "character manifest loaded",
      );
    } catch (err) {
      ctx.log.warn({ err: String(err) }, "character manifest failed to load — placeholder mints");
    }
  }

  const redisUrl = new URL(env.redisUrl);
  const connection: ConnectionOptions = {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    db: Number(redisUrl.pathname.replace("/", "") || 0),
    maxRetriesPerRequest: null,
  };
  const queue = new Queue(QUEUE, { connection });
  const mintQueue = new Queue(MINT_QUEUE, { connection });

  // Repeatable jobs: one per tick, same cadence as the in-process scheduler.
  const intervals = tickIntervalsMs(env);
  for (const name of Object.keys(TICKS) as TickName[]) {
    await queue.add(name, {}, {
      repeat: { every: intervals[name] },
      jobId: `tick:${name}`,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }
  await queue.add(HEARTBEAT_JOB, {}, {
    repeat: { every: 60_000 },
    jobId: `tick:${HEARTBEAT_JOB}`,
    removeOnComplete: 10,
    removeOnFail: 10,
  });

  // Weekly burn: Sunday 16:00 UTC (doc 09). Only in prod (non-beta) — beta keeps
  // burns purely in-ledger.
  if (!env.beta) {
    await queue.add(WEEKLY_BURN_JOB, {}, {
      repeat: { pattern: "0 16 * * 0", tz: "UTC" },
      jobId: `tick:${WEEKLY_BURN_JOB}`,
      removeOnComplete: 20,
      removeOnFail: 20,
    });
  }

  const ticksWorker = new Worker(
    QUEUE,
    async (job) => {
      if (job.name === HEARTBEAT_JOB) {
        await ctx.db.insert(auditLog).values({
          actor: "worker",
          action: "heartbeat",
          detail: { at: new Date().toISOString() },
        });
        return;
      }
      if (job.name === WEEKLY_BURN_JOB) {
        await executeWeeklyBurn(ctx, { discordWebhookUrl: env.discordAdminWebhookUrl });
        return;
      }
      // The withdrawal payout tick gets the worker's custody preflight wrapper.
      if (job.name === ("withdrawals" satisfies TickName)) {
        await runWithdrawalPayouts(ctx, { discordWebhookUrl: env.discordAdminWebhookUrl });
        return;
      }
      const tick = TICKS[job.name as TickName];
      if (!tick) {
        ctx.log.warn({ job: job.name }, "unknown tick job");
        return;
      }
      await tick(ctx);
    },
    { connection, concurrency: 1 },
  );

  // Mint fulfillment worker: serial per process, retries on failure (the API
  // already burned the $SHINY, so failures park as failed_retry — never refund).
  const mintWorker = new Worker(
    MINT_QUEUE,
    async (job) => {
      const orderId = String((job.data as { orderId?: string }).orderId ?? "");
      if (!orderId) throw new Error("mint job missing orderId");
      await fulfillMintOrder(ctx, orderId, { manifest });
    },
    { connection, concurrency: 1 },
  );

  ticksWorker.on("failed", (job, err) => {
    ctx.log.error({ err, job: job?.name }, "tick job failed");
  });
  mintWorker.on("failed", (job, err) => {
    ctx.log.error({ err, job: job?.id }, "mint fulfillment job failed (will retry)");
  });

  const shutdown = async () => {
    ctx.log.info("worker shutting down");
    await ticksWorker.close();
    await mintWorker.close();
    await queue.close();
    await mintQueue.close();
    await ctx.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  ctx.log.info({ queue: QUEUE, mintQueue: MINT_QUEUE }, "worker online — ticks + mint queue registered");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/** Exposed for the API to enqueue mint jobs (same queue name + connection). */
export { MINT_QUEUE };
/** Re-export for tests/consumers that want the context type. */
export type { AppContext };
