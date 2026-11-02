# syntax=docker/dockerfile:1.7
# Obot production image (Next.js standalone output + Prisma migrations on start).

ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS base
RUN corepack enable
WORKDIR /app

# ── Dependencies ────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile

# ── Build ───────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Placeholder values only so the build can evaluate config; real values come at runtime.
RUN BETTER_AUTH_SECRET=build-time-placeholder-secret pnpm build

# ── Migration tooling (Prisma CLI only) ─────────────────────
FROM base AS migrate
WORKDIR /migrate
RUN npm init -y >/dev/null && npm install --no-audit --no-fund prisma@7.10.1 dotenv@18
COPY prisma ./prisma
COPY prisma.config.ts ./

# ── Runtime ─────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/app/data/uploads

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs \
 && mkdir -p /app/data/uploads && chown -R nextjs:nodejs /app/data

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=migrate --chown=nextjs:nodejs /migrate /migrate
COPY --chown=nextjs:nodejs docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER nextjs
EXPOSE 3000
VOLUME ["/app/data"]
ENTRYPOINT ["/entrypoint.sh"]
