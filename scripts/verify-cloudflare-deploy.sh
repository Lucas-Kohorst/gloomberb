#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

# Verify routing separately: a successful deploy can update an unserved worker.
curl --fail --silent --show-error --max-time 30 \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains?hostname=terminal.kohor.st" \
  | jq -e '.success == true and any(.result[]; .hostname == "terminal.kohor.st" and .service == "gloomberb-web" and .environment == "production")' >/dev/null
echo "terminal.kohor.st routes to gloomberb-web (production)"

probe_body=$(mktemp)
trap 'rm -f "$probe_body"' EXIT
code=$(curl --silent --show-error --max-time 30 \
  --output "$probe_body" --write-out '%{http_code}' \
  https://terminal.kohor.st/health)
echo "Production health probe: HTTP $code"
case "$code" in
  200)
    jq -e '.status == "ok"' "$probe_body" >/dev/null
    echo "Production health verified"
    ;;
  403)
    echo "::warning::Deployment routing verified, but HTTP 403 prevents runtime health verification from this runner. Check Cloudflare security events for /health."
    ;;
  *)
    echo "::error::Production health returned HTTP $code"
    exit 1
    ;;
esac
