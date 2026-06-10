/**
 * Trash Wars API server. Beta-first: `pnpm dev:api` boots with zero infra —
 * PGlite database, stub chain provider and an in-process scheduler.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import { loadEnv, type Env } from "./core/env.js";
import { buildContext, type AppContext } from "./core/context.js";
import { bootstrap } from "./core/bootstrap.js";
import { AppError } from "./core/errors.js";
import { startInProcessScheduler } from "./core/scheduler.js";
import type { ComplianceProvider } from "./core/compliance.js";
import { sessionHook } from "./modules/session.js";
import authModule from "./modules/auth.js";
import gameModule from "./modules/game.js";
import charactersModule from "./modules/characters.js";
import mintModule from "./modules/mint.js";
import pvpModule from "./modules/pvp.js";
import bankModule from "./modules/bank.js";
import storeModule from "./modules/store.js";
import rafflesModule from "./modules/raffles.js";
import marketModule from "./modules/market.js";
import passModule from "./modules/pass.js";
import publicModule from "./modules/public.js";
import adminModule from "./modules/admin.js";
import wsModule from "./modules/ws.js";

export interface BuildOptions {
  beta?: boolean;
  env?: Record<string, string | undefined>;
  compliance?: ComplianceProvider;
  /** Start the in-process scheduler (default: only in main()). */
  withScheduler?: boolean;
}

export async function build(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const env: Env = loadEnv({
    ...(opts.beta === undefined ? {} : { BETA_MODE: opts.beta ? "1" : "0" }),
    ...opts.env,
  });
  const ctx: AppContext = await buildContext(env, { compliance: opts.compliance });
  await bootstrap(ctx);

  const app = Fastify({
    logger: { level: env.logLevel },
    disableRequestLogging: true,
  });

  app.decorate("ctx", ctx);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: env.webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: env.rateLimitMax, timeWindow: "1 minute" });
  await app.register(websocket);

  // Error envelope: {error:{code,message}} for everything.
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const message = err.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
      return reply.status(400).send({ error: { code: "VALIDATION", message } });
    }
    const statusCode = typeof err.statusCode === "number" && err.statusCode >= 400 ? err.statusCode : 500;
    if (statusCode >= 500) app.log.error({ err }, "unhandled error");
    return reply.status(statusCode).send({
      error: {
        code: statusCode === 429 ? "RATE_LIMITED" : statusCode >= 500 ? "INTERNAL" : "BAD_REQUEST",
        message: statusCode >= 500 ? "internal error" : err.message,
      },
    });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "route not found" } }),
  );

  // Session resolution on every request (cookie → request.user).
  app.addHook("onRequest", sessionHook(ctx));

  await app.register(authModule);
  await app.register(gameModule);
  await app.register(charactersModule);
  await app.register(mintModule);
  await app.register(pvpModule);
  await app.register(bankModule);
  await app.register(storeModule);
  await app.register(rafflesModule);
  await app.register(marketModule);
  await app.register(passModule);
  await app.register(publicModule);
  await app.register(adminModule);
  await app.register(wsModule);

  app.get("/health", async () => ({ ok: true, beta: env.beta, timeScale: env.timeScale }));

  let stopScheduler: (() => void) | undefined;
  if (opts.withScheduler) {
    stopScheduler = startInProcessScheduler(ctx);
  }

  app.addHook("onClose", async () => {
    stopScheduler?.();
    await ctx.close();
  });

  return app;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await build({
    // Scheduling: in-process unless a Redis-backed worker owns the ticks.
    withScheduler: !env.redisUrl,
  });
  await app.listen({ port: env.apiPort, host: "0.0.0.0" });
  app.log.info(
    `Trash Wars API up on :${env.apiPort} (beta=${env.beta}, timeScale=${env.timeScale}, scheduler=${env.redisUrl ? "worker/BullMQ" : "in-process"})`,
  );
}

// Run main() only when executed directly (tsx src/server.ts), not when imported.
if (process.argv[1] && (process.argv[1].endsWith("server.ts") || process.argv[1].endsWith("server.js"))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
