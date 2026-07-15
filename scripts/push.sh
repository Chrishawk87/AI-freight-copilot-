#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# push.sh — ship the current code to Railway the simple way.
#
# The repo is connected to Railway via GitHub, so a push to `main` auto-deploys
# BOTH services (frontend at repo root, backend in /server). This script just
# commits everything and pushes.
#
# Usage:
#   ./scripts/push.sh "your commit message"
#   ./scripts/push.sh                 # uses a timestamped message
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

MSG="${1:-deploy: $(date '+%Y-%m-%d %H:%M:%S')}"

if [[ -z "$(git status --porcelain)" ]]; then
  echo "Nothing to commit — working tree clean. Pushing anyway to trigger a deploy…"
else
  echo "Staging and committing changes…"
  git add -A
  git commit -m "$MSG"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Pushing '$BRANCH' to origin…"
git push origin "$BRANCH"

echo ""
echo "Pushed. Railway will build and deploy automatically."
echo "Watch the deploys at https://railway.app  (or run: railway logs)"
