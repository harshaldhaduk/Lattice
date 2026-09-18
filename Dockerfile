FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY scripts/build.mjs ./scripts/build.mjs
RUN npm run build

FROM build AS verify
COPY tsconfig.json ./
COPY test ./test
RUN apk add --no-cache git && npm run typecheck && npm test

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4319 LATTICE_DATA_DIR=/data LATTICE_AUTH=github
WORKDIR /app
COPY --from=verify /app/dist/relay.cjs ./relay.cjs
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4319
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD node -e "fetch('http://127.0.0.1:4319/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "relay.cjs"]
