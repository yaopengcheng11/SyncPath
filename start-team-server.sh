#!/usr/bin/env bash
#
# SyncPath — start the team server on macOS.
#
# Starts PostgreSQL if needed, then runs the API and web app together, both
# bound to 0.0.0.0 so teammates on the LAN can reach them. Ctrl+C stops both.
#
# Usage:
#   ./start-team-server.sh              # reachable from the LAN
#   LOCAL_ONLY=1 ./start-team-server.sh # reachable only from this Mac
#   VITE_PORT=5184 ./start-team-server.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$REPO_DIR/apps/api"
PG_DIR="$REPO_DIR/.postgres"
WEB_PORT="${VITE_PORT:-5183}"
API_PORT_NUM="${API_PORT:-3160}"
DB_PORT="${PGPORT:-5433}"

say() { printf '\033[1;36m[syncpath]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[syncpath]\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$API_DIR/.env" ] || die "apps/api/.env is missing. Run ./setup-mac.sh first."

# ── Locate PostgreSQL tools ────────────────────────────────────────────────
PG_BIN=""
for p in "/opt/homebrew/opt/postgresql@16/bin" "/opt/homebrew/opt/postgresql/bin" \
         "/usr/local/opt/postgresql@16/bin" "/usr/local/opt/postgresql/bin" \
         "/Applications/Postgres.app/Contents/Versions/latest/bin"; do
  [ -x "$p/pg_ctl" ] && { PG_BIN="$p"; break; }
done
[ -n "$PG_BIN" ] && export PATH="$PG_BIN:$PATH"

# ── Database ───────────────────────────────────────────────────────────────
if ! pg_isready -h 127.0.0.1 -p "$DB_PORT" -q 2>/dev/null; then
  command -v pg_ctl >/dev/null 2>&1 \
    || die "PostgreSQL is not running and pg_ctl was not found. Run ./setup-mac.sh first."
  say "Starting PostgreSQL ..."
  pg_ctl -D "$PG_DIR/data" -l "$PG_DIR/postgres.log" -o "-p $DB_PORT" start >/dev/null
  for _ in $(seq 1 30); do
    pg_isready -h 127.0.0.1 -p "$DB_PORT" -q 2>/dev/null && break
    sleep 1
  done
fi
pg_isready -h 127.0.0.1 -p "$DB_PORT" -q 2>/dev/null \
  || die "PostgreSQL did not start — see .postgres/postgres.log"
say "PostgreSQL is up on 127.0.0.1:$DB_PORT"

# ── Refuse to start on a busy port ─────────────────────────────────────────
for p in "$WEB_PORT" "$API_PORT_NUM"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    die "Port $p is already in use. Stop the other instance first, or pick another port."
  fi
done

# ── Environment ────────────────────────────────────────────────────────────
export VITE_PORT="$WEB_PORT"
export VITE_HOST="0.0.0.0"
export VITE_STRICT_PORT="true"
export VITE_API_TARGET="http://127.0.0.1:${API_PORT_NUM}"
export API_PORT="$API_PORT_NUM"
export API_HOST="0.0.0.0"
export COOKIE_SECURE="false"
export COOKIE_SAMESITE="lax"

if [ "${LOCAL_ONLY:-0}" = "1" ]; then
  export VITE_HOST="127.0.0.1"
  export API_HOST="127.0.0.1"
fi

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
[ -z "$LAN_IP" ] && LAN_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"

say "web  -> http://${VITE_HOST}:${WEB_PORT}"
if [ "$VITE_HOST" = "0.0.0.0" ] && [ -n "$LAN_IP" ]; then
  say "team -> http://${LAN_IP}:${WEB_PORT}/"
fi
say "Ctrl+C stops both."

# `npm run dev` is the repo's own concurrently runner: web + API, colour-coded,
# one Ctrl+C stops everything.
cd "$REPO_DIR"
exec npm run dev