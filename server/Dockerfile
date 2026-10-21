# GOLD RING server image.
#
# The server runs TypeScript directly through tsx, and imports the shared
# package from the workspace, so the whole monorepo is copied in. The client is
# built separately and served as static files.

FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first for better layer caching.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# Source.
COPY shared ./shared
COPY server ./server
COPY client ./client

# Non-root runtime user and a writable data directory.
RUN addgroup -S goldring && adduser -S goldring -G goldring \
    && mkdir -p /app/data && chown -R goldring:goldring /app
USER goldring

ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/app/data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["npx", "tsx", "server/src/index.ts"]
