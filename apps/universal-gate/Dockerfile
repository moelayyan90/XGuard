FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

COPY apps/edge-gate ./apps/edge-gate
COPY apps/universal-gate ./apps/universal-gate

WORKDIR /app/apps/universal-gate
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/__xguard/health >/dev/null || exit 1

CMD ["node", "src/server.js"]
