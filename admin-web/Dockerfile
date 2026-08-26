# Admin Web image. The browser bundle is environment independent; the API
# upstream is validated and injected into Nginx only when the container starts.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache ca-certificates
ARG COMMIT_SHA=local
ARG RELEASE_ID=local
ARG BUILD_CREATED_AT=unknown
LABEL org.opencontainers.image.title="banking-admin-web" \
      org.opencontainers.image.source="https://github.com/NguyenCaoKy1603/banking-system" \
      org.opencontainers.image.revision="${COMMIT_SHA}" \
      org.opencontainers.image.created="${BUILD_CREATED_AT}" \
      org.opencontainers.image.version="${RELEASE_ID}"
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/admin-web/nginx.conf.template
COPY docker-entrypoint.d/10-validate-runtime-config.sh /docker-entrypoint.d/10-validate-runtime-config.sh
# Run the static server as the unprivileged nginx user. The server listens on
# 8080 because a non-root process cannot bind the privileged port 80.
RUN chmod 0555 /docker-entrypoint.d/10-validate-runtime-config.sh \
    && mkdir -p /var/cache/nginx /var/log/nginx /var/run /etc/nginx/admin-web \
    && chown -R nginx:nginx /var/cache/nginx /var/log/nginx /var/run /etc/nginx/conf.d /etc/nginx/admin-web /usr/share/nginx/html \
    && sed -i -E 's#pid[[:space:]]+/run/nginx.pid;#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf
USER nginx
EXPOSE 8080
