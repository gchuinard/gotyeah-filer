# syntax=docker/dockerfile:1

# Image Docker multi-stage pour Filer (Next.js 16, output: 'standalone').
# Cible : Raspberry Pi 5 (arm64) sous Docker. glibc (debian) pour les
# binaires natifs de better-sqlite3 (prébuilts dispo, sinon compilés).

FROM node:24-bookworm-slim AS base

# --- Dépendances ---
FROM base AS deps
WORKDIR /app
# Outils de compilation au cas où better-sqlite3 doit être bâti depuis les sources.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- Build ---
FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Runner ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Utilisateur non-root dédié.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Répertoire de données (fichiers uploadés + base SQLite), monté en volume.
# Créé et possédé par nextjs pour que le volume nommé hérite des bons droits.
RUN mkdir -p /data/files && chown -R nextjs:nodejs /data

# Artefacts du build standalone.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

# server.js est généré par le build standalone de Next.
CMD ["node", "server.js"]
