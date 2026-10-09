#!/usr/bin/env bash
#
# SyncPath — stop the team server on macOS.
#
# Only touches processes whose executable lives inside this project directory,
# so a Node process belonging to something else on your Mac is never killed.
#
# Usage:
#   ./stop-team-server.sh              # stop web + API, leave the database up
#   ./stop-team-server.sh --with-db    # also stop PostgreSQL

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WITH_DB=0
[ "${1:-}" = "--with-db" ] && WITH_DB=1

say() { printf '\033[1;36m[syncpath]\033[0m %s\n' "$*"; }

# Match on the executable path, never on command-line text: this script's own
# command line contains these very words and would otherwise match itself.
stop_matching() {
  local pattern="$1" label="$2" killed=0 pid cwd
  for pid in $(pgrep -f "$pattern" 2>/dev/null || true); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    case "$cwd" in
      "$REPO_DIR"*)
        say "stopping $label pid=$pid"
        kill "$pid" 2>/dev/null || true
        killed=$((killed + 1))
        ;;
      *)
        # Running from somewhere else (e.g. a globally installed copy) — leave it be.
        ;;
    esac
  done
  say "stopped $killed $label process(es)"
}

stop_matching 'apps/web.*vite|vite.*apps/web' 'web'
stop_matching 'apps/api.*nest|nest start|dist/main' 'api'
stop_matching 'concurrently.*syncpath' 'concurrently'

if [ "$WITH_DB" = "1" ]; then
  PG_BIN=""
  for p in "/opt/homebrew/opt/postgresql@16/bin" "/opt/homebrew/opt/postgresql/bin" \
           "/usr/local/opt/postgresql@16/bin" "/usr/local/opt/postgresql/bin"; do
    [ -x "$p/pg_ctl" ] && { PG_BIN="$p"; break; }
  done
  if [ -n "$PG_BIN" ] && [ -d "$REPO_DIR/.postgres/data" ]; then
    "$PG_BIN/pg_ctl" -D "$REPO_DIR/.postgres/data" -m fast stop >/dev/null 2>&1 && say "stopped PostgreSQL"
  fi
fi

say "done"