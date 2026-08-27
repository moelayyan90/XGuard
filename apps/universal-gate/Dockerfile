FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

# Edge Gate executes from /app/apps/edge-gate, so its production dependencies
# must exist in that package's own resolution path.
COPY apps/edge-gate/package.json ./apps/edge-gate/package.json
WORKDIR /app/apps/edge-gate
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force
COPY apps/edge-gate/src ./src

# Universal Gate is a thin Node adapter around the same Edge Gate runtime.
COPY apps/universal-gate/package.json /app/apps/universal-gate/package.json
WORKDIR /app/apps/universal-gate
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force
COPY apps/universal-gate/src ./src

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/__xguard/health >/dev/null || exit 1

CMD ["node", "src/server.js"]
