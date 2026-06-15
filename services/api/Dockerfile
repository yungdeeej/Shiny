# syntax=docker/dockerfile:1
#
# Trash Wars — API image (services/api, Fastify on :4000).
#
# WHY tsx-at-runtime (no tsc build step) for v1:
#   The services run TypeScript source directly via `tsx` (see services/api
#   package.json `start`: "tsx src/server.ts"). The whole pnpm workspace is a set
#   of `workspace:*` source packages (@trash-wars/db, /economy, /chain, /shared)
#   that the api imports as TS — there is no compiled `dist/` for them. Running
#   from source keeps the image build simple and guarantees parity with `pnpm
#   dev:api`. The tradeoff is a slightly larger runtime (tsx + a transpile on
#   cold start) and shipping devDeps. For v1 this is acceptable; a follow-up
#   optimization is a `tsc`/`tsup` build per package + `node dist/server.js` on a
#   pruned production install (`pnpm deploy`). Tracked as a later optimization,
#   not a launch blocker.
#
# Multi-stage: a `deps` stage warms the pnpm store cache; the runtime stage
# carries the full workspace + installed modules.

# ---- deps: install the whole workspace from the frozen lockfile -------------
FROM node:22-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Copy the full workspace (api/worker share workspace:* source deps, so a
# partial copy would break the install graph). The .dockerignore keeps this lean.
COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- runtime ----------------------------------------------------------------
FROM node:22-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
# Prod is not beta: require real Postgres + Redis + chain config (see env.ts).
ENV BETA_MODE=0
ENV API_PORT=4000
RUN corepack enable

# curl for the container HEALTHCHECK
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app /app

EXPOSE 4000

# The API serves /health (services/api/src/server.ts) → { ok: true, ... }.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:4000/health || exit 1

# `start` = tsx src/server.ts; the server migrates + seeds on boot (see README).
CMD ["pnpm", "--filter", "@trash-wars/api", "start"]
