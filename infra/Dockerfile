# syntax=docker/dockerfile:1.7
# ----- builder -----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile=false
RUN pnpm -r build

# Prune to production deps for the server.
RUN pnpm --filter @crab/server deploy --prod /app/server-prod

# ----- runtime -----
# distroless: no shell, no package manager, non-root by default.
FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production \
    CRAB_HOST=0.0.0.0 \
    CRAB_PORT=3000 \
    CRAB_WORKSPACE_DIR=/data

COPY --from=builder --chown=nonroot:nonroot /app/server-prod ./

# Workspace volume must be writable; everything else is read-only at runtime
# (enforced by `--read-only` in docker-compose / k8s).
VOLUME ["/data"]
EXPOSE 3000

CMD ["dist/index.js"]
