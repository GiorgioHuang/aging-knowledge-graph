#!/usr/bin/env bash
# Provision a Neon (or any) Postgres from $DATABASE_URL: apply migrations, load
# the curated seed, compute + load embeddings (offline embedder), and run a
# sample pgvector search. Uses psql (libpq) — no Node driver needed for setup.
#   DATABASE_URL=postgres://... bash scripts/neon-setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${DATABASE_URL:?set DATABASE_URL (Neon connection string) first}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1)

echo "==> migrate 0001 (core schema)";        "${PSQL[@]}" -q -f "$ROOT/db/migrations/0001_init.sql"
echo "==> migrate 0002 (pgvector embeddings)"; "${PSQL[@]}" -q -f "$ROOT/db/migrations/0002_embeddings.sql"
echo "==> load seed";        node --experimental-strip-types "$ROOT/scripts/seed-to-sql.ts"  | "${PSQL[@]}" -q
echo "==> load embeddings";  node --experimental-strip-types "$ROOT/scripts/embed-to-sql.ts" | "${PSQL[@]}" -q

echo "==> counts"
"${PSQL[@]}" -c "SELECT
  (SELECT count(*) FROM node) AS nodes, (SELECT count(*) FROM claim) AS claims,
  (SELECT count(*) FROM evidence) AS evidence, (SELECT count(*) FROM embedding) AS embeddings;"

echo "==> sample pgvector search: 'falling in the elderly'"
node --experimental-strip-types "$ROOT/src/cli.ts" query search "falling in the elderly"

echo
echo "Neon setup OK (pgvector live)."
