#!/bin/sh
set -eu

fail() {
  echo "admin-web runtime configuration error: $*" >&2
  exit 1
}

environment=${ADMIN_WEB_ENV:-}
upstream=${ADMIN_API_UPSTREAM:-}

case "$environment" in
  preview|staging|production-like) ;;
  "") fail "ADMIN_WEB_ENV is required (preview, staging or production-like)" ;;
  *) fail "ADMIN_WEB_ENV is invalid" ;;
esac

[ -n "$upstream" ] || fail "ADMIN_API_UPSTREAM is required"

case "$upstream" in
  http://*) scheme=http; authority=${upstream#http://} ;;
  https://*) scheme=https; authority=${upstream#https://} ;;
  *) fail "ADMIN_API_UPSTREAM must be an absolute HTTP(S) origin" ;;
esac

[ -n "$authority" ] || fail "ADMIN_API_UPSTREAM must include a host"
case "$authority" in
  # A single trailing slash is the root path and is still an origin. Normalize
  # it before rendering proxy_pass; any deeper path remains rejected below.
  */) authority=${authority%/} ;;
esac
case "$authority" in
  */*|*\?*|*\#*|*@*) fail "ADMIN_API_UPSTREAM must be an origin without credentials, path, query or fragment" ;;
esac
case "$authority" in
  *[!A-Za-z0-9._:-]*) fail "ADMIN_API_UPSTREAM contains unsupported host characters" ;;
esac

host=${authority%%:*}
[ -n "$host" ] || fail "ADMIN_API_UPSTREAM must include a host"

case "$environment:$scheme" in
  preview:http|preview:https|staging:https|production-like:https) ;;
  staging:http|production-like:http) fail "HTTPS is required outside preview" ;;
  *) fail "ADMIN_API_UPSTREAM scheme is invalid for ADMIN_WEB_ENV" ;;
esac

upstream="$scheme://$authority"

if [ "$environment" = "preview" ] && [ "$scheme" = "http" ]; then
  case "$host" in
    localhost|127.0.0.1|[A-Za-z0-9-]*) ;;
    *) fail "preview HTTP upstream must use localhost or a container-network host" ;;
  esac
  case "$host" in
    *.*) [ "$host" = "127.0.0.1" ] || fail "preview HTTP upstream must use localhost or a container-network host" ;;
  esac
fi

template=/etc/nginx/admin-web/nginx.conf.template
output=/etc/nginx/conf.d/default.conf
[ -r "$template" ] || fail "Nginx template is missing"

# The validation above excludes the sed delimiter and replacement metacharacter.
safe_upstream=$(printf '%s' "$upstream" | sed 's/[&|]/\\&/g')
sed "s|__ADMIN_API_UPSTREAM__|$safe_upstream|g" "$template" > "$output"
nginx -t -c /etc/nginx/nginx.conf
