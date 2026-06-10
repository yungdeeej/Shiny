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

export default async function wsModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

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
      clearInterval(heartbeat);
      for (const unsub of unsubscribers) unsub();
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });
}
