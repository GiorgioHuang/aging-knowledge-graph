#!/usr/bin/env bash
# Prove V0 against a REAL Postgres: spin an ephemeral cluster, run the migration,
# load the generated seed, and run example queries. No external services needed.
# Requires: postgres 16 client+server (initdb, pg_ctl, psql) on PATH.
# If run as root, the server is run as the unprivileged `postgres` user.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort | tail -1 || true)"
export PATH="${PGBIN:-}:$PATH"

# Generate the seed SQL first (as the current user; writes into the repo).
node --experimental-strip-types "$ROOT/scripts/seed-to-sql.ts" > "$ROOT/db/seed.generated.sql"

TMP="$(mktemp -d)"
DB="graceage"
if [ "$(id -u)" = "0" ]; then RUNAS=(runuser -u postgres --); chown postgres "$TMP"; else RUNAS=(); fi
PGDATA="$TMP/data"
SOCK="$TMP/sock"; mkdir -p "$SOCK"
[ "$(id -u)" = "0" ] && chown postgres "$SOCK"

cleanup() { "${RUNAS[@]}" pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "==> initdb"
"${RUNAS[@]}" initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null

echo "==> start server (unix socket only)"
"${RUNAS[@]}" pg_ctl -D "$PGDATA" -o "-c listen_addresses='' -k '$SOCK'" -w start >/dev/null

PSQL=("${RUNAS[@]}" psql -h "$SOCK" -U postgres -v ON_ERROR_STOP=1)
echo "==> create database"
"${RUNAS[@]}" createdb -h "$SOCK" -U postgres "$DB"

echo "==> apply migration 0001"
"${PSQL[@]}" -q -d "$DB" -f "$ROOT/db/migrations/0001_init.sql"

echo "==> load seed"
"${PSQL[@]}" -q -d "$DB" -f "$ROOT/db/seed.generated.sql"

echo "==> counts"
"${PSQL[@]}" -d "$DB" -c "SELECT
  (SELECT count(*) FROM node)           AS nodes,
  (SELECT count(*) FROM claim)          AS claims,
  (SELECT count(*) FROM evidence)       AS evidence,
  (SELECT count(*) FROM claim_relation) AS contradictions;"

echo "==> CQ1: what affects fall rate, with certainty + citations"
"${PSQL[@]}" -d "$DB" -c "SELECT s.name AS subject, c.type, c.direction, c.certainty,
               string_agg(e.source_id, '; ') AS sources
        FROM claim c
        JOIN node s ON s.id = c.subject_id
        LEFT JOIN evidence e ON e.claim_id = c.id
        WHERE c.object_id = 'ga:fall-rate'
        GROUP BY s.name, c.type, c.direction, c.certainty
        ORDER BY c.certainty;"

echo "==> CQ13: contradictions, scoped by population/dose"
"${PSQL[@]}" -d "$DB" -c "SELECT a.id AS claim_a, a.direction AS dir_a, a.population_id AS pop_a, a.dose,
               b.id AS claim_b, b.direction AS dir_b
        FROM claim_relation r
        JOIN claim a ON a.id = r.subject_claim_id
        JOIN claim b ON b.id = r.object_claim_id;"

echo
echo "PostgreSQL V0 verification OK."
