#!/usr/bin/env bash
#
# SyncPath — one-time setup for macOS.
#
# Prepares everything a fresh Mac needs: Node dependencies, a self-contained
# PostgreSQL, the application database, and — if the bundled dump is present and
# the database is still empty — your existing cards and teammates.
#
# Usage:
#   ./setup-mac.sh               # normal setup, restores the bundled data
#   ./setup-mac.sh --no-restore  # start from an empty database
#
# Safe to re-run: an existing apps/api/.env, database and data are left alone.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$REPO_DIR/apps/api"
PG_DIR="$REPO_DIR/.postgres"
DB_DATA_DIR="$PG_DIR/data"
WEB_PORT="${VITE_PORT:-5183}"
API_PORT_NUM="${API_PORT:-3160}"
DB_NAME="${SYNCPATH_DB_NAME:-syncpath_dev}"
DB_USER="${SYNCPATH_DB_USER:-syncpath}"
# 5433, not 5432: Homebrew often already runs a system PostgreSQL on 5432 and we
# must not talk to — or disturb — that one.
DB_PORT="${PGPORT:-5433}"
RESTORE=1
[ "${1:-}" = "--no-restore" ] && RESTORE=0

say()  { printf '\033[1;36m[syncpath]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[syncpath]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[syncpath]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 0. Architecture ---------------------------------------------------------
ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  HOMEBREW_PREFIX="/opt/homebrew"; ARCH_LABEL="Apple Silicon" ;;
  x86_64) HOMEBREW_PREFIX="/usr/local";   ARCH_LABEL="Intel" ;;
  *) die "Unsupported architecture: $ARCH" ;;
esac
say "Detected $ARCH_LABEL ($ARCH)"

# ── 1. Node ────────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node 18.18+ from https://nodejs.org, then re-run this script."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node $(node -v) is too old — this project needs >= 18.18.0."
say "Node $(node -v), npm $(npm -v)"

# ── 2. Homebrew (only used to install PostgreSQL) ──────────────────────────
export PATH="$HOMEBREW_PREFIX/bin:$PATH"
BREW="$(command -v brew 2>/dev/null || true)"

find_pg() {
  local p
  for p in "$HOMEBREW_PREFIX/opt/postgresql@16/bin" "$HOMEBREW_PREFIX/opt/postgresql/bin" \
           "/usr/local/opt/postgresql@16/bin" "/usr/local/opt/postgresql/bin" \
           "/Applications/Postgres.app/Contents/Versions/latest/bin"; do
    [ -x "$p/pg_ctl" ] && { echo "$p"; return 0; }
  done
  command -v pg_ctl >/dev/null 2>&1 && { dirname "$(command -v pg_ctl)"; return 0; }
  return 1
}

if ! PG_BIN="$(find_pg)"; then
  [ -n "$BREW" ] || die "PostgreSQL is not installed and Homebrew is unavailable.
Install Homebrew from https://brew.sh (or PostgreSQL 16), then re-run this script."
  say "Installing PostgreSQL 16 with Homebrew — this can take a few minutes ..."
  "$BREW" install postgresql@16
  PG_BIN="$(find_pg)" || die "PostgreSQL installed but pg_ctl still not found."
fi
export PATH="$PG_BIN:$PATH"
say "PostgreSQL tools: $PG_BIN"

# ── 3. Cluster ─────────────────────────────────────────────────────────────
# The database lives inside this folder, so deleting the folder removes the data
# too and nothing is left installed system-wide.
if [ ! -s "$DB_DATA_DIR/PG_VERSION" ]; then
  say "Creating a self-contained database in .postgres/data ..."
  mkdir -p "$DB_DATA_DIR"
  initdb -D "$DB_DATA_DIR" -U "$DB_USER" -E UTF8 --locale=C >/dev/null
fi

if ! pg_isready -h 127.0.0.1 -p "$DB_PORT" -q 2>/dev/null; then
  say "Starting PostgreSQL on port $DB_PORT ..."
  pg_ctl -D "$DB_DATA_DIR" -l "$PG_DIR/postgres.log" -o "-p $DB_PORT" start >/dev/null
  for _ in $(seq 1 30); do
    pg_isready -h 127.0.0.1 -p "$DB_PORT" -q 2>/dev/null && break
    sleep 1
  done
  pg_isready -h 127.0.0.1 -p "$DB_PORT" -q 2>/dev/null || die "PostgreSQL did not start — see .postgres/postgres.log"
fi
say "PostgreSQL is up on 127.0.0.1:$DB_PORT"

# ── 4. Role, password, database ────────────────────────────────────────────
if [ -s "$PG_DIR/dbpass" ]; then
  DB_PASSWORD="$(cat "$PG_DIR/dbpass")"
  say "Reusing the password already in .postgres/dbpass"
else
  DB_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")"
  printf '%s' "$DB_PASSWORD" > "$PG_DIR/dbpass"
  chmod 600 "$PG_DIR/dbpass"
  say "Generated a database password (kept in .postgres/dbpass)"
fi

psql_super() { psql -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 "$@"; }

if [ "$(psql_super -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")" != "1" ]; then
  psql_super -c "CREATE ROLE \"$DB_USER\" LOGIN CREATEDB PASSWORD '$DB_PASSWORD'" >/dev/null
  say "Created database role $DB_USER"
else
  psql_super -c "ALTER ROLE \"$DB_USER\" WITH LOGIN CREATEDB PASSWORD '$DB_PASSWORD'" >/dev/null
  say "Updated role $DB_USER"
fi

if [ "$(psql_super -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")" != "1" ]; then
  createdb -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
  say "Created database $DB_NAME"
else
  say "Database $DB_NAME already exists"
fi

# ── 5. .env ────────────────────────────────────────────────────────────────
if [ -f "$API_DIR/.env" ]; then
  say "apps/api/.env exists — leaving it untouched"
else
  SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")"
  cat > "$API_DIR/.env" <<ENVEOF
# Generated by setup-mac.sh — local / LAN use only.
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}?schema=public"

SESSION_SECRET="${SESSION_SECRET}"
SESSION_COOKIE_NAME="syncpath_session"
SESSION_TTL_DAYS=30

# 0.0.0.0 lets teammates on the LAN connect. Use 127.0.0.1 for this Mac only.
API_HOST=0.0.0.0
API_PORT=${API_PORT_NUM}

# Plain HTTP inside a LAN, so the session cookie must not require HTTPS.
# If you later serve this over HTTPS, change this to COOKIE_SECURE=true.
COOKIE_SECURE=false
COOKIE_SAMESITE=lax

CORS_ORIGIN=http://localhost:${WEB_PORT}
ENVEOF
  say "Wrote apps/api/.env"
fi

# ── 6. Dependencies ────────────────────────────────────────────────────────
# postinstall builds @syncpath/domain and runs `prisma generate`, which
# downloads the query engine matching THIS Mac. node_modules must never be
# copied from another computer — the native binaries are platform-specific.
say "Installing dependencies (also regenerating the Prisma client for $ARCH) ..."
( cd "$REPO_DIR" && npm install --no-audit --no-fund )

# ── 7. Schema ──────────────────────────────────────────────────────────────
# migrate deploy applies only migrations that have not run yet; existing rows
# are never modified, so this is safe on a populated database.
say "Applying database migrations ..."
( cd "$API_DIR" && npx prisma migrate deploy )

# ── 8. Restore the bundled data ────────────────────────────────────────────
DUMP="$REPO_DIR/syncpath_dev.dump"
HAS_DATA="$(psql -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT count(*) FROM workspaces" 2>/dev/null || echo 0)"

if [ "$RESTORE" = "0" ]; then
  warn "Skipping the data restore (--no-restore) — you will start empty"
elif [ ! -f "$DUMP" ]; then
  say "No data dump bundled — starting empty"
elif [ "$HAS_DATA" != "0" ]; then
  say "Database already has rows — skipping the restore (it runs only once)"
else
  say "Restoring your existing data ..."
  pg_restore -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --clean --if-exists "$DUMP" >/dev/null 2>&1 \
    || pg_restore -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$DUMP" >/dev/null
  say "Data restored — sign in with your existing accounts"
fi

# ── 9. Summary ─────────────────────────────────────────────────────────────
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
[ -z "$LAN_IP" ] && LAN_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"

echo
echo "  Setup complete."
echo
echo "    Start the team server :  ./start-team-server.sh"
echo "    Stop it               :  ./stop-team-server.sh"
echo
echo "    On this Mac           :  http://127.0.0.1:${WEB_PORT}/"
if [ -n "$LAN_IP" ]; then
echo "    On your LAN           :  http://${LAN_IP}:${WEB_PORT}/   <- share this"
fi
echo
echo "  If teammates cannot connect, allow incoming connections on port ${WEB_PORT}:"
echo "  System Settings -> Network -> Firewall -> Options."
echo