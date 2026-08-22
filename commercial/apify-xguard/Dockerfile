FROM apify/actor-node:24

COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet set progress=false \
  && npm install --omit=dev --no-audit --no-fund

COPY --chown=myuser:myuser . ./

CMD ["npm", "start"]
