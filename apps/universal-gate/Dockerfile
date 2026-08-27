FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

# Copy manifests first so host/CI node_modules can never leak into the image.
COPY apps/edge-gate/package.json ./apps/edge-gate/package.json
COPY apps/universal-gate/package.json ./apps/universal-gate/package.json

WORKDIR /app/apps/universal-gate
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Copy runtime source only after dependencies are installed cleanly.
COPY apps/edge-gate/src /app/apps/edge-gate/src
COPY apps/universal-gate/src /app/apps/universal-gate/src

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/__xguard/health >/dev/null || exit 1

CMD ["node", "src/server.js"]
