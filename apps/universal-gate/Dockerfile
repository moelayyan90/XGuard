FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

# Copy the local Edge Gate package including runtime source before npm install.
# The repository-level .dockerignore prevents host/CI node_modules from entering
# the image, so the file: dependency is packed from a clean source tree.
COPY apps/edge-gate ./apps/edge-gate
COPY apps/universal-gate/package.json ./apps/universal-gate/package.json

WORKDIR /app/apps/universal-gate
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY apps/universal-gate/src ./src

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/__xguard/health >/dev/null || exit 1

CMD ["node", "src/server.js"]
