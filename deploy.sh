#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}"
: "${GEMINI_API_KEY:?Set GEMINI_API_KEY}"
REGION="${GOOGLE_CLOUD_REGION:-us-central1}"
SERVICE="${TRIMGATE_SERVICE:-trimgate-agent}"
SA_NAME="${TRIMGATE_SERVICE_ACCOUNT:-trimgate-runtime}"
SA_EMAIL="${SA_NAME}@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com"
SECRET="trimgate-gemini-key"

gcloud config set project "$GOOGLE_CLOUD_PROJECT"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com

# Durable state. Firestore supports regional us-central1; creation is skipped when present.
gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 || \
  gcloud firestore databases create \
    --database='(default)' \
    --location="$REGION" \
    --edition=standard \
    --type=firestore-native

# Runtime identity with only the application permissions it needs.
gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --display-name="TrimGate Cloud Run runtime"
gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/datastore.user" \
  --quiet >/dev/null

# Create/update the Gemini API key secret without placing the key in source or env flags.
if gcloud secrets describe "$SECRET" >/dev/null 2>&1; then
  printf '%s' "$GEMINI_API_KEY" | gcloud secrets versions add "$SECRET" --data-file=- >/dev/null
else
  printf '%s' "$GEMINI_API_KEY" | gcloud secrets create "$SECRET" --replication-policy=automatic --data-file=- >/dev/null
fi
gcloud secrets add-iam-policy-binding "$SECRET" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --service-account="$SA_EMAIL" \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_MODEL=gemini-3.5-flash,GOOGLE_CLOUD_PROJECT=$GOOGLE_CLOUD_PROJECT,TRIMGATE_STORAGE=firestore" \
  --set-secrets="GEMINI_API_KEY=$SECRET:latest" \
  --min=0 \
  --max=2 \
  --memory=512Mi \
  --cpu=1 \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
printf '\nTrimGate deployed: %s\n' "$URL"
printf 'Health: %s/health\n' "$URL"
printf 'Demo:   %s\n' "$URL"
