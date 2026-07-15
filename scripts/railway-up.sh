#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# railway-up.sh — deploy both services straight from your machine with the
# Railway CLI (no GitHub round-trip). Useful for a quick manual deploy.
#
# Prereqs (one time):
#   npm i -g @railway/cli        # install the CLI
#   railway login                # sign in
#   railway link                 # pick your project (run once in this folder)
#
# Service names default to "backend" and "frontend" — override if yours differ:
#   BACKEND_SERVICE=api FRONTEND_SERVICE=web ./scripts/railway-up.sh
#
# Deploy just one:
#   ./scripts/railway-up.sh backend
#   ./scripts/railway-up.sh frontend
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-frontend}"
TARGET="${1:-all}"

if ! command -v railway >/dev/null 2>&1; then
  echo "Railway CLI not found. Install it with:  npm i -g @railway/cli" >&2
  exit 1
fi

deploy_backend() {
  echo "▶ Deploying backend (service: $BACKEND_SERVICE) from /server …"
  ( cd "$ROOT/server" && railway up --service "$BACKEND_SERVICE" )
  echo "✔ Backend deploy triggered."
}

deploy_frontend() {
  echo "▶ Deploying frontend (service: $FRONTEND_SERVICE) from repo root …"
  ( cd "$ROOT" && railway up --service "$FRONTEND_SERVICE" )
  echo "✔ Frontend deploy triggered."
}

case "$TARGET" in
  backend)  deploy_backend ;;
  frontend) deploy_frontend ;;
  all)      deploy_backend; deploy_frontend ;;
  *) echo "Unknown target '$TARGET' (use: backend | frontend | all)" >&2; exit 1 ;;
esac

echo ""
echo "Done. Tail logs with:  railway logs --service $BACKEND_SERVICE"
