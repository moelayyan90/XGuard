FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/mcp-example/package.json apps/mcp-example/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY examples/x402-xguard-starter/package.json examples/x402-xguard-starter/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npm run typecheck && npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8787 XGUARD_DATABASE_PATH=/data/xguard.db
WORKDIR /app
RUN groupadd --system xguard && useradd --system --gid xguard --home-dir /app xguard && mkdir /data && chown xguard:xguard /data
COPY --from=build --chown=xguard:xguard /app/node_modules ./node_modules
COPY --from=build --chown=xguard:xguard /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=build --chown=xguard:xguard /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=xguard:xguard /app/packages/core/package.json ./packages/core/package.json
USER xguard
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/gateway/dist/server.js"]
