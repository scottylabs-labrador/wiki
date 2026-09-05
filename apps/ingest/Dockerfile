# Base image with Bun
FROM oven/bun:latest AS base
WORKDIR /app

# Build stage
FROM base AS builder

# Copy dependency manifests first so install is cached when only source changes
COPY package.json bun.lock ./
COPY --parents apps/*/package.json packages/*/package.json ./
RUN bun ci

# Build the ingestion job
COPY . .
RUN bun run build --filter=@wiki/ingest...

# Final runtime image
FROM base AS runner
WORKDIR /app

# Create non-root user
RUN groupadd --system --gid 1001 ingest && \
    useradd --system --uid 1001 --gid 1001 ingest

# The wiki is cloned over anonymous HTTPS by a JavaScript git client, so this
# image needs no git binary and no credentials.
COPY --from=builder --chown=ingest:ingest \
  /app/apps/ingest/dist \
  /app/apps/ingest/dist

USER ingest
WORKDIR /app/apps/ingest
CMD ["bun", "dist/main.js"]
