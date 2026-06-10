/**
 * Trash Wars worker — thin BullMQ shell around the SAME tick functions the API's
 * in-process scheduler runs (@trash-wars/api/core). Requires REDIS_URL; without it
 * the API schedules everything itself and this process is unnecessary.
 */
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import {
  TICKS,
  tickIntervalsMs,
  loadEnv,
  buildContext,
  bootstrap,
  type TickName,
} from "@trash-wars/api/core";
import { auditLog } from "@trash-wars/db";

const QUEUE = "trash-wars-ticks";
const HEARTBEAT_JOB = "heartbeat";

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.redisUrl) {
    console.error(
      "worker: REDIS_URL is not set. In beta the API runs its own in-process scheduler — " +
        "this worker only makes sense with Redis. Exiting.",
    );
    process.exit(1);
  }

  const ctx = await buildContext(env);
  await bootstrap(ctx);
  ctx.log.info("worker context ready");

  // Plain options object (not an ioredis instance) so BullMQ's bundled ioredis
  // typings never clash with this package's own ioredis version.
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

  const worker = new Worker(
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
      const tick = TICKS[job.name as TickName];
      if (!tick) {
        ctx.log.warn({ job: job.name }, "unknown tick job");
        return;
      }
      await tick(ctx);
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    ctx.log.error({ err, job: job?.name }, "tick job failed");
  });

  const shutdown = async () => {
    ctx.log.info("worker shutting down");
    await worker.close();
    await queue.close();
    await ctx.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  ctx.log.info({ queue: QUEUE }, "worker online — ticks registered");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
