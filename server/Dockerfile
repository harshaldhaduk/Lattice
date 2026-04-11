FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY extension/package.json ./extension/

# Install all deps (needed for workspace hoisting)
RUN npm ci --workspace=shared --workspace=server --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY server/ ./server/

# Build shared first, then server
RUN npm run build -w shared
RUN npm run build -w server

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Only copy what the server needs at runtime
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/

# Create data directory for SQLite
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
