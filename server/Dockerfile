FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace manifests + lock file
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY extension/package.json ./extension/

# Full install for building (includes devDependencies like tsc)
RUN npm ci --ignore-scripts

# Copy source and build
COPY shared/ ./shared/
COPY server/ ./server/
RUN npm run build -w shared
RUN npm run build -w server

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV LATTICE_DB_PATH=/data/lattice.db

# Copy manifests + lock file so we can do a fresh prod-only install.
# This guarantees every package (hoisted or workspace-local) is present —
# copying node_modules from the builder misses workspace-specific subdirs.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY extension/package.json ./extension/

RUN npm ci --ignore-scripts --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/shared/dist ./shared/dist

# Writable volume for SQLite database
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
