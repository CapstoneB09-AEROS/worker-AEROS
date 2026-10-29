# Deploy this folder as a BACKGROUND WORKER (no HTTP port required).
# Do not bake .env, Supabase keys, or HiveMQ passwords into the image.
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node mqtt-worker.js ./
COPY --chown=node:node src/ ./src/

USER node
CMD ["node", "mqtt-worker.js"]
