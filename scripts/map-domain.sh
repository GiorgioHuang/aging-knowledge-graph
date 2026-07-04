#!/usr/bin/env bash
# Map a custom domain to the Cloud Run service (Google-managed TLS), for use with
# Cloudflare DNS. Run with gcloud authenticated.
#   bash scripts/map-domain.sh api.yourdomain.com
#
# Prereq: verify domain ownership once (adds a TXT record you put in Cloudflare):
#   gcloud domains verify yourdomain.com      # opens Search Console flow
set -euo pipefail

DOMAIN="${1:?usage: map-domain.sh <hostname e.g. api.yourdomain.com>}"
SERVICE="${SERVICE:-graceage-knowledge}"
REGION="${REGION:-us-east1}"
PROJECT="${PROJECT:-giorgio-h}"

echo "== creating domain mapping ${DOMAIN} -> ${SERVICE} (${REGION}) =="
gcloud beta run domain-mappings create \
  --service "$SERVICE" --domain "$DOMAIN" --region "$REGION" --project "$PROJECT" 2>/dev/null \
  || echo "  (mapping may already exist)"

echo "== DNS records to add in Cloudflare (set to DNS only / grey cloud) =="
gcloud beta run domain-mappings describe \
  --domain "$DOMAIN" --region "$REGION" --project "$PROJECT" \
  --format="table(status.resourceRecords[].name, status.resourceRecords[].type, status.resourceRecords[].rrdata)"

echo
echo "Then wait for the Google-managed certificate to become ACTIVE:"
echo "  gcloud beta run domain-mappings describe --domain ${DOMAIN} --region ${REGION} --project ${PROJECT} --format='value(status.conditions)'"
