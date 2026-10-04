# Production image for Nexus. SQLite lives on the host bind mount (`./data`) so
# the database survives container recreation; the entrypoint remaps the `node`
# user to PUID/PGID so WAL/SHM sidecar files stay host-writable.

ARG NODE_VERSION=24-bookworm-slim

# ── dependencies ────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps

WORKDIR /app

# better-sqlite3 compiles a native addon; the toolchain is only needed here.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV HUSKY=0
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

COPY package.json pnpm-lock.yaml ./

# The cache mount is a different filesystem; copy into node_modules so later
# `COPY --from=deps` does not carry broken store symlinks.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --package-import-method copy \
  && chmod -R a+rX /app/node_modules

# ── build ───────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV HUSKY=0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `data/` is dockerignored (host bind mount). The directory must exist because
# Next imports the DB client while collecting page data; the migration itself
# runs in the entrypoint before the server starts.
RUN --mount=type=cache,target=/app/.next/cache \
  mkdir -p data && pnpm build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  # The entrypoint drops privileges with setpriv (util-linux, part of the base
  # image) so it can hand the app ambient capabilities; assert it is there.
  && setpriv --version >/dev/null

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100
ENV HOSTNAME=0.0.0.0
ENV HOME=/tmp
ENV npm_config_cache=/tmp/.npm

# Full tree (not standalone): the migration script runs through tsx and resolves
# the `@/` alias from tsconfig.json.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/next.config.mjs /app/tsconfig.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /app/data /app/.next/cache \
  && chmod a+rX /app

# World-readable app files so an arbitrary host UID can run the process; the
# entrypoint drops privileges to PUID:PGID with setpriv and owns only
# /app/data + cache.
EXPOSE 3100

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/migrate-databases.ts && exec node_modules/.bin/next start -H 0.0.0.0 -p 3100"]
