#!/usr/bin/env bash
# One-time GCP setup for GitHub Actions -> Cloud Run (keyless, via Workload
# Identity Federation) + Secret Manager for DATABASE_URL.
# Run with gcloud authenticated as a project owner. Re-runnable (creates are
# guarded). Defaults target this project; override via env vars.
#
#   DATABASE_URL='postgresql://…?sslmode=require&channel_binding=require' \
#     bash scripts/setup-gcp.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID to your GCP project id}"
PROJECT_NUMBER="${PROJECT_NUMBER:-$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')}"
REPO="${REPO:-giorgiohuang/aging-knowledge-graph}"
REGION="${REGION:-us-east1}"
POOL="${POOL:-github-pool}"
PROVIDER="${PROVIDER:-github}"
SA_NAME="${SA_NAME:-deployer}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"  # Cloud Run default runtime identity

echo "== project ${PROJECT_ID} (#${PROJECT_NUMBER}), repo ${REPO} =="
gcloud config set project "$PROJECT_ID" >/dev/null

echo "== enable APIs =="
gcloud services enable \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

echo "== deployer service account =="
gcloud iam service-accounts create "$SA_NAME" \
  --display-name "GitHub Actions deployer" 2>/dev/null || echo "  (exists)"

echo "== grant deployer roles =="
for ROLE in roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.admin \
            roles/storage.admin roles/iam.serviceAccountUser roles/secretmanager.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${SA_EMAIL}" --role "$ROLE" --condition=None >/dev/null
done

echo "== workload identity pool + OIDC provider for GitHub =="
gcloud iam workload-identity-pools create "$POOL" \
  --location=global --display-name="GitHub Actions" 2>/dev/null || echo "  (pool exists)"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
  --location=global --workload-identity-pool="$POOL" \
  --display-name="GitHub" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository=='${REPO}'" 2>/dev/null || echo "  (provider exists)"

echo "== allow the repo to impersonate the deployer SA =="
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" >/dev/null

echo "== DATABASE_URL secret =="
if [ -n "${DATABASE_URL:-}" ]; then
  if gcloud secrets describe DATABASE_URL >/dev/null 2>&1; then
    printf '%s' "$DATABASE_URL" | gcloud secrets versions add DATABASE_URL --data-file=-
  else
    printf '%s' "$DATABASE_URL" | gcloud secrets create DATABASE_URL --data-file=- --replication-policy=automatic
  fi
  gcloud secrets add-iam-policy-binding DATABASE_URL \
    --member "serviceAccount:${RUNTIME_SA}" --role roles/secretmanager.secretAccessor >/dev/null
  echo "  secret set; runtime SA granted accessor"
else
  echo "  DATABASE_URL not provided — create it later:"
  echo "    printf '%s' 'postgres://…' | gcloud secrets create DATABASE_URL --data-file=- --replication-policy=automatic"
fi

cat <<EOF

== DONE. Set these GitHub repo Variables (Settings -> Secrets and variables -> Actions -> Variables):
  GCP_PROJECT_ID       = ${PROJECT_ID}
  GCP_WIF_PROVIDER     = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}
  GCP_SERVICE_ACCOUNT  = ${SA_EMAIL}
  GCP_REGION           = ${REGION}

Then trigger: GitHub -> Actions -> "Deploy to Cloud Run" -> Run workflow.
EOF
