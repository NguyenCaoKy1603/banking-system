# Admin Web preview image. The API URL is injected at build time; no staff
# token, invite token or TOTP secret is copied into the image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
ARG VITE_ADMIN_API_URL=http://127.0.0.1:5001/api/v1
ENV VITE_ADMIN_API_URL=${VITE_ADMIN_API_URL}
RUN npm run build

FROM nginx:1.27-alpine
ARG COMMIT_SHA=local
ARG RELEASE_ID=local
ARG BUILD_CREATED_AT=unknown
LABEL org.opencontainers.image.title="banking-admin-web" \
      org.opencontainers.image.source="https://github.com/NguyenCaoKy1603/banking-system" \
      org.opencontainers.image.revision="${COMMIT_SHA}" \
      org.opencontainers.image.created="${BUILD_CREATED_AT}" \
      org.opencontainers.image.version="${RELEASE_ID}"
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Run the static server as the unprivileged nginx user. The server listens on
# 8080 because a non-root process cannot bind the privileged port 80.
RUN mkdir -p /var/cache/nginx /var/log/nginx /var/run \
    && chown -R nginx:nginx /var/cache/nginx /var/log/nginx /var/run /etc/nginx/conf.d /usr/share/nginx/html \
    && sed -i -E 's#pid[[:space:]]+/run/nginx.pid;#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf
USER nginx
EXPOSE 8080
