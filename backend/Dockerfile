# syntax=docker/dockerfile:1

ARG NODE_BASE_IMAGE=node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

FROM ${NODE_BASE_IMAGE} AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY database ./database
RUN npm run typecheck && npm run build

FROM ${NODE_BASE_IMAGE} AS production-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${NODE_BASE_IMAGE} AS runtime

ARG COMMIT_SHA=local
ARG RELEASE_ID=local
ARG BUILD_CREATED_AT=unknown
ARG API_CONTRACT_DIGEST=unknown
LABEL org.opencontainers.image.title="banking-reference-backend" \
      org.opencontainers.image.source="https://github.com/NguyenCaoKy1603/banking-system" \
      org.opencontainers.image.revision="${COMMIT_SHA}" \
      org.opencontainers.image.created="${BUILD_CREATED_AT}" \
      org.opencontainers.image.version="${RELEASE_ID}"
ENV NODE_ENV=production \
    BANKING_ENV=staging \
    BANKING_MONEY_MODE=virtual \
    BANKING_STORAGE=postgres \
    PORT=5000 \
    BUILD_COMMIT_SHA=${COMMIT_SHA} \
    RELEASE_ID=${RELEASE_ID} \
    BUILD_CREATED_AT=${BUILD_CREATED_AT} \
    API_CONTRACT_DIGEST=${API_CONTRACT_DIGEST}

WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/database ./database
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --chown=node:node scripts/apply-migration.cjs scripts/container-smoke.cjs scripts/outbox-inspect.cjs scripts/outbox-inventory.cjs scripts/validate-outbox-worker.cjs scripts/postgres-ssl.cjs ./scripts/

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5000/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

EXPOSE 5000
CMD ["node", "dist/server.js"]
