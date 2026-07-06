#!/usr/bin/env bash
# Deploy the Healthy Aging Knowledge REST API to Google Cloud Run.
# Cloud Run has open egress, so it reaches Neon's HTTPS endpoint directly
# (no allowlist juggling). Run from a machine with gcloud authenticated.
#
#   1) one-time: provision the DB from a machine that can reach Neon:
#        DATABASE_URL='postgres://…?sslmode=require' npm run db:setup
#   2) store the connection string as a secret:
#        printf '%s' 'postgres://…?sslmode=require' | \
#          gcloud secrets create DATABASE_URL --data-file=- --replication-policy=automatic
#      (rotate later: gcloud secrets versions add DATABASE_URL --data-file=-)
#   3) deploy:
#        REGION=us-east1 bash scripts/deploy-cloudrun.sh
set -euo pipefail

SERVICE="${SERVICE:-graceage-knowledge}"
REGION="${REGION:-us-east1}"

exec gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 --memory 512Mi --min-instances 0 --max-instances 3 \
  --update-secrets "DATABASE_URL=DATABASE_URL:latest"
  # --update-secrets (not --set-secrets) so other mounts like CURATOR_TOKEN,
  # added out-of-band to enable writes, survive subsequent deploys.
  # Quick test without Secret Manager: --set-env-vars "DATABASE_URL=postgres://…"
