#!/bin/bash
#
#  AI Freight Co-Pilot — one-click launcher
#  Double-click this file. It starts the app and opens it in your browser.
#  Closing this window stops the app.
#
set -u

# Always run from the folder this script lives in.
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

echo "======================================================"
echo "   AI Freight Co-Pilot"
echo "======================================================"
echo ""

# ---- 1. Make sure Node.js is installed ----
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed on this Mac."
  echo "  Opening the download page — install it, then double-click this again."
  open "https://nodejs.org/en/download/"
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi
echo "  Node.js detected: $(node -v)"
echo ""

# ---- 2. Install dependencies the first time ----
if [ ! -d "$ROOT/node_modules" ]; then
  echo "  First-time setup: installing the web app (this takes a minute)..."
  npm install --silent || { echo "  Web install failed."; read -n 1 -s -r -p "Press any key..."; exit 1; }
fi

FRESH_BACKEND=0
if [ ! -d "$ROOT/server/node_modules" ]; then
  echo "  First-time setup: installing the engine (this takes a minute)..."
  ( cd server && npm install --silent ) || { echo "  Engine install failed."; read -n 1 -s -r -p "Press any key..."; exit 1; }
  FRESH_BACKEND=1
fi

# ---- 3. Build the database the first time ----
if [ "$FRESH_BACKEND" = "1" ] || [ ! -f "$ROOT/server/dev.db" ]; then
  echo "  First-time setup: preparing the database..."
  ( cd server && npm run setup ) || { echo "  Database setup failed."; read -n 1 -s -r -p "Press any key..."; exit 1; }
fi

echo ""
echo "  Starting the app..."
echo ""

# ---- 4. Clean up anything already using our ports ----
lsof -ti:4000 2>/dev/null | xargs kill -9 2>/dev/null
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null

# ---- 5. Shut everything down cleanly when this window closes ----
cleanup() {
  echo ""
  echo "  Shutting down AI Freight Co-Pilot..."
  lsof -ti:4000 2>/dev/null | xargs kill -9 2>/dev/null
  lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null
  exit 0
}
trap cleanup EXIT INT TERM HUP

# ---- 6. Start the engine (API) and the web app ----
( cd server && npm run dev ) > "$ROOT/.api.log" 2>&1 &
npm run dev > "$ROOT/.web.log" 2>&1 &

# ---- 7. Wait until the web app is ready, then open the browser ----
echo -n "  Warming up"
for i in $(seq 1 60); do
  if curl -s http://localhost:3000 >/dev/null 2>&1; then
    break
  fi
  echo -n "."
  sleep 1
done
echo ""
echo ""
echo "  Ready. Opening http://localhost:3000"
echo ""
echo "  Log in with:   demo@aifreight.co  /  demo1234"
echo ""
echo "  ---------------------------------------------------"
echo "   KEEP THIS WINDOW OPEN while you use the app."
echo "   Close it (or press Ctrl-C) to stop the app."
echo "  ---------------------------------------------------"
open "http://localhost:3000"

# ---- 8. Keep running until the window is closed ----
wait
