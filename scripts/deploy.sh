#!/usr/bin/env bash
# Publishes dist/ to Cloudflare as static assets (wrangler.jsonc; the current form of Cloudflare
# Pages). Needs CLOUDFLARE_API_TOKEN (Workers Scripts: Edit) and CLOUDFLARE_ACCOUNT_ID in the
# environment. Never commit them.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_API_TOKEN:?Falta CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?Falta CLOUDFLARE_ACCOUNT_ID}"
[ -d dist ] || scripts/build.sh
# Slow or IPv4-only networks make wrangler's 10 s API timeout trip now and then: retry.
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first" WRANGLER_SEND_METRICS=false
for intento in 1 2 3 4; do
  npx --yes wrangler@4 deploy && exit 0
  echo "Intento $intento falló; reintento en 5 s…"; sleep 5
done
exit 1
