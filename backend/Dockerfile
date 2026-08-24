# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY database ./database
RUN npm run typecheck && npm run build

FROM node:22-bookworm-slim AS production-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ARG COMMIT_SHA=local
ENV NODE_ENV=preview \
    BANKING_ENV=preview \
    BANKING_STORAGE=postgres \
    PORT=5000 \
    BUILD_COMMIT_SHA=${COMMIT_SHA}

WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/database ./database
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --chown=node:node scripts/apply-migration.cjs scripts/container-smoke.cjs ./scripts/

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5000/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

EXPOSE 5000
CMD ["node", "dist/server.js"]
