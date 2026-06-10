/**
 * WebSocket endpoint: city feed broadcast + per-user private events.
 * Session auth happens on the upgrade request via the root session hook.
 */
import type { FastifyInstance } from "fastify";
import { recentFeed } from "../core/feed.js";

interface WsLike {
  readyState: number;
  send(data: string): void;
  ping(): void;
  close(): void;
  on(event: "close" | "error", fn: () => void): void;
  on(event: "message", fn: (data: unknown) => void): void;
}

const OPEN = 1;
/** jackpot_tick broadcasts at most once per 10s (specs/03). */
const JACKPOT_TICK_THROTTLE_MS = 10_000;

export default async function wsModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  // v1.1 (specs/03): broadcast {type:"jackpot_tick", pool} to every socket when
  // the pool changes, throttled globally to >=10s with a trailing send.
  const sockets = new Set<WsLike>();
  let lastTickAt = 0;
  let pendingTick: NodeJS.Timeout | null = null;
  const broadcastJackpot = async () => {
    lastTickAt = Date.now();
    const pool = await ctx.ledger.getBalance(ctx.accounts.jackpot_pool);
    const payload = JSON.stringify({ type: "jackpot_tick", pool: pool.toString() });
    for (const ws of sockets) {
      if (ws.readyState === OPEN) {
        try {
          ws.send(payload);
        } catch {
          /* socket raced shut */
        }
      }
    }
  };
  const unsubscribeJackpot = ctx.bus.onJackpot(() => {
    if (pendingTick) return; // a trailing tick is already scheduled
    const elapsed = Date.now() - lastTickAt;
    if (elapsed >= JACKPOT_TICK_THROTTLE_MS) {
      void broadcastJackpot().catch((err) => ctx.log.error({ err }, "jackpot tick failed"));
    } else {
      pendingTick = setTimeout(() => {
        pendingTick = null;
        void broadcastJackpot().catch((err) => ctx.log.error({ err }, "jackpot tick failed"));
      }, JACKPOT_TICK_THROTTLE_MS - elapsed);
      pendingTick.unref?.();
    }
  });
  app.addHook("onClose", async () => {
    unsubscribeJackpot();
    if (pendingTick) clearTimeout(pendingTick);
  });

  app.get("/ws", { websocket: true }, (socket, request) => {
    const ws = socket as unknown as WsLike;
    const send = (payload: unknown) => {
      if (ws.readyState === OPEN) {
        try {
          ws.send(JSON.stringify(payload));
        } catch {
          /* socket raced shut */
        }
      }
    };

    // Backlog: the last 30 feed events on connect. Clients may also request it
    // explicitly with {"type":"sync"} (covers clients that attach listeners late).
    const sendBacklog = () =>
      void recentFeed(ctx, 30)
        .then((events) => send({ type: "feed_backlog", events }))
        .catch((err) => ctx.log.error({ err }, "ws backlog failed"));
    sendBacklog();
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === "sync") sendBacklog();
      } catch {
        /* ignore malformed frames */
      }
    });

    sockets.add(ws);
    const unsubscribers: (() => void)[] = [];
    unsubscribers.push(ctx.bus.onFeed((event) => send({ type: "feed", event })));
    const userId = request.user?.id;
    if (userId) {
      unsubscribers.push(ctx.bus.onUser(userId, (event) => send({ type: "user", event })));
    }

    const heartbeat = setInterval(() => {
      if (ws.readyState === OPEN) {
        try {
          ws.ping();
        } catch {
          /* ignore */
        }
      }
    }, 30_000);
    heartbeat.unref?.();

    const cleanup = () => {
      sockets.delete(ws);
      clearInterval(heartbeat);
      for (const unsub of unsubscribers) unsub();
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });
}
