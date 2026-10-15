# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY recipes ./recipes
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/recipes ./recipes
COPY package.json ./
RUN mkdir -p /data /vaults && chown -R node:node /data
USER node
EXPOSE 8787 8790 8791
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "dist/main.js"]
