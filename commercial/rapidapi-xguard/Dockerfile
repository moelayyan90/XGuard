FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --chown=node:node src ./src

USER node
EXPOSE 8080
CMD ["node", "src/server.mjs"]
