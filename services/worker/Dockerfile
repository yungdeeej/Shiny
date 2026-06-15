# syntax=docker/dockerfile:1
#
# Trash Wars — Worker image (services/worker, BullMQ; no public port).
#
# WHY tsx-at-runtime: identical rationale to services/api/Dockerfile — the worker
# runs `tsx src/main.ts` and imports the @trash-wars/* workspace packages as TS
# source. No public port is exposed; the worker is a queue consumer + scheduler.
#
# SECURITY: the worker (and ONLY the worker) holds the hot-wallet and
# mint-authority signing keys. Per doc 05, these keys must never be present in
# the api process env. Set them as Fly secrets on trash-wars-worker only.
#
# Multi-stage mirrors the api image so both share the warm pnpm store cache.

# ---- deps -------------------------------------------------------------------
FROM node:22-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- runtime ----------------------------------------------------------------
FROM node:22-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
ENV BETA_MODE=0
RUN corepack enable

WORKDIR /app
COPY --from=deps /app /app

# No EXPOSE / HEALTHCHECK: the worker has no HTTP server. Liveness is observed
# via its BullMQ heartbeat job (audit_log) and Fly's process supervision.

# `start` = tsx src/main.ts
CMD ["pnpm", "--filter", "@trash-wars/worker", "start"]
