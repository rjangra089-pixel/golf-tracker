#!/usr/bin/env bash
# Runs the browser regression suite in an isolated headless Chrome against a
# throwaway local static server. Every Supabase and /api request is answered by
# the suite's mock — nothing reaches the real database.
#
# Env overrides: APP (test another URL, e.g. production), APP_PORT, CDP_PORT,
# CHROME (path to Chrome), ONLY (regex of test names), SHOTS (dir for screenshots).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PORT="${APP_PORT:-3123}"
CDP_PORT="${CDP_PORT:-9333}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$PROFILE"; }
trap cleanup EXIT

if [ -z "${APP:-}" ]; then
  python3 -I -m http.server "$APP_PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
  PIDS+=($!)
  APP="http://localhost:$APP_PORT/"
fi
"$CHROME" --headless=new --remote-debugging-port="$CDP_PORT" --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check --disable-extensions about:blank >/dev/null 2>&1 &
PIDS+=($!)

for _ in $(seq 1 40); do
  curl -s "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 && curl -s -o /dev/null "$APP" && break
  sleep 0.25
done

APP="$APP" node "$ROOT/tests/browser/regression.js" "$CDP_PORT"
