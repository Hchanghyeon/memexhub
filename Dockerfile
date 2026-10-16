# syntax=docker/dockerfile:1
# Base image pinned by digest (Dependabot keeps it current). Node 24 LTS on Alpine.
ARG NODE_IMAGE=node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f

FROM ${NODE_IMAGE} AS build
# better-sqlite3 compiles its native module when no prebuilt binary matches (Alpine + this Node version).
# The tools stay in this stage; the runtime image only gets the compiled result.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY recipes ./recipes
RUN npm run build && npm prune --omit=dev && npm cache clean --force

FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.source="https://github.com/Hchanghyeon/memexhub" \
      org.opencontainers.image.description="Self-hosted LLM Wiki engine for Claude" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production DATA_DIR=/data VAULT_ROOTS=/vaults
WORKDIR /app
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY --from=build --chown=root:root /app/recipes ./recipes
COPY --chown=root:root package.json ./
COPY --chown=root:root assets ./assets
# The app code is owned by root and read-only for the app user; only /data and /vaults are writable.
RUN mkdir -p /data /vaults && chown node:node /data /vaults && chmod 700 /data
USER node
EXPOSE 8787 8790 8791
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "dist/main.js"]
