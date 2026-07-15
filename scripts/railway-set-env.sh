#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# railway-set-env.sh — push environment variables to the Railway services.
#
# It only sets a variable if you've provided a value for it in your OWN shell
# (nothing is hard-coded — no secrets live in the repo). Set the ones you want,
# then run this. Unset ones are skipped.
#
# The BIG two that turn AI on for every subscriber:
#   ANTHROPIC_API_KEY   — company Claude key (powers the Co-Pilot for everyone)
#   OCR_API_KEY         — company Mindee key (powers document scanning for everyone)
#
# Example:
#   export ANTHROPIC_API_KEY="sk-ant-…"
#   export OCR_API_KEY="…"
#   export USAGE_OCR_MONTHLY_CAP="500"
#   export USAGE_LLM_MONTHLY_CAP="2000"
#   export JWT_SECRET="$(openssl rand -base64 48)"
#   ./scripts/railway-set-env.sh
#
# Service names default to "backend" / "frontend" (override via env):
#   BACKEND_SERVICE=api FRONTEND_SERVICE=web ./scripts/railway-set-env.sh
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-frontend}"

if ! command -v railway >/dev/null 2>&1; then
  echo "Railway CLI not found. Install it with:  npm i -g @railway/cli" >&2
  exit 1
fi

# set_var <service> <KEY> — sets KEY on the service from the same-named env var,
# but only if that env var is set and non-empty. Values are never echoed.
set_var() {
  local service="$1" key="$2"
  local val="${!key:-}"
  if [[ -n "$val" ]]; then
    railway variables --service "$service" --set "$key=$val" >/dev/null
    echo "  ✔ $key set on $service"
  else
    echo "  – $key skipped (not provided)"
  fi
}

echo "Setting BACKEND variables (service: $BACKEND_SERVICE)…"
for k in \
  JWT_SECRET JWT_EXPIRES_IN CORS_ORIGIN \
  OCR_PROVIDER OCR_API_KEY \
  ANTHROPIC_API_KEY ANTHROPIC_MODEL \
  USAGE_OCR_MONTHLY_CAP USAGE_LLM_MONTHLY_CAP \
  SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM \
  DAT_API_KEY LOADBOARD123_API_KEY TRUCKSTOP_API_KEY UBER_FREIGHT_API_KEY MAPBOX_TOKEN
do
  set_var "$BACKEND_SERVICE" "$k"
done

echo ""
echo "Setting FRONTEND variables (service: $FRONTEND_SERVICE)…"
set_var "$FRONTEND_SERVICE" "NEXT_PUBLIC_API_URL"

echo ""
echo "Note: DATABASE_URL should reference the Postgres service in the Railway UI"
echo "      (set it to \${{Postgres.DATABASE_URL}}), not via this script."
echo "Reminder: NEXT_PUBLIC_* is baked in at BUILD time — redeploy the frontend"
echo "          after changing NEXT_PUBLIC_API_URL."
