#!/usr/bin/env bash
# Deploy the GraceAge Knowledge agents (Curator + Reviewer) as a Cloud Run JOB,
# triggered on a schedule by Cloud Scheduler — this is the "continuous" loop:
# every tick, one cycle expands the graph and reviews new claims.
#
# The Job runs scripts/agent-run.ts using the SAME image/source as the API. It
# needs two secrets from Secret Manager:
#   DATABASE_URL       — Neon connection string (already created for the API)
#   ANTHROPIC_API_KEY  — for the Curator/Reviewer LLM calls (create it first):
#        printf '%s' 'sk-ant-...' | \
#          gcloud secrets create ANTHROPIC_API_KEY --data-file=- --replication-policy=automatic
#
# Run from a machine with gcloud authenticated:
#   REGION=us-east1 SCHEDULE='0 3 * * *' bash scripts/deploy-agents.sh
set -euo pipefail

JOB="${JOB:-graceage-agents}"
REGION="${REGION:-us-east1}"
SCHEDULE="${SCHEDULE:-0 3 * * *}"           # default: once a day (03:00 UTC)
PROJECT="$(gcloud config get-value project 2>/dev/null)"
TOPICS_PER_RUN="${CURATOR_TOPICS_PER_RUN:-3}"
CLAIMS_PER_RUN="${REVIEWER_CLAIMS_PER_RUN:-12}"

echo "==> Deploying Cloud Run Job '$JOB' in $REGION (project $PROJECT)"
# Optional per-agent model overrides (otherwise the DB setting / default applies).
ENVS="CURATOR_TOPICS_PER_RUN=${TOPICS_PER_RUN},REVIEWER_CLAIMS_PER_RUN=${CLAIMS_PER_RUN}"
[ -n "${CURATOR_MODEL:-}" ]  && ENVS="${ENVS},CURATOR_MODEL=${CURATOR_MODEL}"
[ -n "${REVIEWER_MODEL:-}" ] && ENVS="${ENVS},REVIEWER_MODEL=${REVIEWER_MODEL}"

# Build the image from the Dockerfile (node:22-slim → node on PATH, scripts/ copied).
# NOT buildpacks (--source): its launcher sets up PATH, which --command bypasses,
# so `node` isn't found and the container fails with "exec failed".
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${JOB}:latest}"
if ! gcloud artifacts repositories describe cloud-run-source-deploy --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create cloud-run-source-deploy --repository-format=docker --location "$REGION"
fi
echo "==> Building image $IMAGE from the Dockerfile"
gcloud builds submit --tag "$IMAGE" .

gcloud run jobs deploy "$JOB" \
  --image "$IMAGE" \
  --region "$REGION" \
  --command node \
  --args="--experimental-strip-types,scripts/agent-run.ts" \
  --cpu 1 --memory 512Mi --max-retries 1 --task-timeout 1800s \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest" \
  --set-env-vars "$ENVS"

# Cloud Scheduler needs a service account allowed to run the job.
SA="${SCHEDULER_SA:-graceage-scheduler@${PROJECT}.iam.gserviceaccount.com}"
if ! gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
  echo "==> Creating scheduler service account $SA"
  gcloud iam service-accounts create graceage-scheduler --display-name "GraceAge agent scheduler"
fi
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" \
  --member "serviceAccount:${SA}" --role roles/run.invoker

JOB_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run"
SCHED="${JOB}-tick"
echo "==> Scheduling '$SCHED' ($SCHEDULE)"
if gcloud scheduler jobs describe "$SCHED" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$SCHED" --location "$REGION" \
    --schedule "$SCHEDULE" --uri "$JOB_URI" --http-method POST \
    --oauth-service-account-email "$SA"
else
  gcloud scheduler jobs create http "$SCHED" --location "$REGION" \
    --schedule "$SCHEDULE" --uri "$JOB_URI" --http-method POST \
    --oauth-service-account-email "$SA"
fi

echo "==> Done. Trigger one cycle now with:"
echo "    gcloud run jobs execute $JOB --region $REGION"
