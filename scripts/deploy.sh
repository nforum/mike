#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  MikeOSS — local deploy helper
#
#  Builds the Word add-in into frontend/public/word-addin/ and then
#  deploys mike-frontend + mike-backend to Cloud Run using Buildpacks
#  (`gcloud run deploy --source .`), the same path the services were
#  originally created with.
#
#  Use this when you want a one-shot deploy from your laptop without
#  Cloud Build. For a managed CI pipeline, prefer `cloudbuild.yaml`:
#
#      gcloud builds submit --config=cloudbuild.yaml
#
#  Override service names / URLs by exporting env vars before running
#  the script, e.g.:
#
#      FRONTEND_URL=https://mike-frontend-xxx-ew.a.run.app ./scripts/deploy.sh
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-mikeoss-495610}"
REGION="${REGION:-europe-west1}"
# Cloud Build region. Pin to europe-west1 so workers, source bucket and
# Artifact Registry all live in the same region as the Cloud Run services
# (faster builds, lower egress, no cross-region transfer cost).
BUILD_REGION="${BUILD_REGION:-europe-west1}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-mike-frontend}"
BACKEND_SERVICE="${BACKEND_SERVICE:-mike-backend}"
FRONTEND_URL="${FRONTEND_URL:-https://mike-frontend-cc6nrgescq-ew.a.run.app}"
BACKEND_URL="${BACKEND_URL:-https://mike-backend-cc6nrgescq-ew.a.run.app}"

# Limit the run to a single service if the user passes "frontend" or "backend".
TARGET="${1:-all}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() {
    printf "\n\033[1;34m▶ %s\033[0m\n" "$*"
}

build_addin() {
    # API_BASE_URL is read by webpack (dotenv-webpack with systemvars: true)
    # and inlined into the bundle for `process.env.API_BASE_URL`. Without it,
    # the runtime fallback `window.location.origin` kicks in — which is the
    # frontend Cloud Run URL (since the bundle is served from
    # <frontend>/word-addin/). The add-in then POSTs `/auth/pair/start` to
    # mike-frontend, gets back the Next.js HTML page, and the pairing UI
    # shows raw `<!DOCTYPE html>...` text instead of the 6-digit input.
    log "Word add-in: install + production build (ADDIN_URL=$FRONTEND_URL, API_BASE_URL=$BACKEND_URL)"
    (
        cd word-addin
        npm install --no-audit --no-fund
        ADDIN_URL="$FRONTEND_URL" API_BASE_URL="$BACKEND_URL" npm run build
    )
    if grep -q '\${ADDIN_URL}' frontend/public/word-addin/manifest.xml; then
        echo "ERROR: manifest still has unsubstituted \${ADDIN_URL} placeholders" >&2
        exit 1
    fi
    if ! grep -q "$BACKEND_URL" frontend/public/word-addin/taskpane.bundle.js; then
        echo "ERROR: taskpane.bundle.js does not contain BACKEND_URL=$BACKEND_URL" >&2
        echo "       webpack DefinePlugin (dotenv-webpack systemvars) didn't pick up API_BASE_URL." >&2
        exit 1
    fi
    log "Word add-in: emitted $(ls -1 frontend/public/word-addin | wc -l | xargs) files into frontend/public/word-addin/ (API_BASE inlined ✓)"
}

deploy_frontend() {
    # NEXT_PUBLIC_* env vars MUST be present at build time — Next.js
    # inlines them into the client bundle during `next build`. Setting
    # them only at runtime via --set-env-vars has no effect on the
    # already-baked JS shipped to the browser, which is why the deployed
    # frontend was hitting `http://localhost:3001` in production.
    #
    # `gcloud run deploy --source` runs the Dockerfile in Cloud Build.
    # We (1) write `.env.production` for Next and (2) pass
    # `--set-build-env-vars` so Docker ARGs get values even if an ignore
    # file accidentally strips `.env.production` from the upload (paths
    # under `--source frontend` are relative to that folder, so root
    # .gcloudignore's `!frontend/.env.production` does not match).
    log "Frontend: writing .env.production with NEXT_PUBLIC_API_BASE_URL=$BACKEND_URL"
    cat > frontend/.env.production <<EOF
NEXT_PUBLIC_API_BASE_URL=$BACKEND_URL
NEXT_PUBLIC_BACKEND_URL=$BACKEND_URL
EOF
    trap 'rm -f frontend/.env.production' EXIT

    log "Frontend: gcloud run deploy --source frontend (build env NEXT_PUBLIC_*)"
    gcloud run deploy "$FRONTEND_SERVICE" \
        --source frontend \
        --region "$REGION" \
        --project "$PROJECT_ID" \
        --set-build-env-vars "NEXT_PUBLIC_API_BASE_URL=${BACKEND_URL},NEXT_PUBLIC_BACKEND_URL=${BACKEND_URL}" \
        --quiet

    rm -f frontend/.env.production
    trap - EXIT
}

deploy_backend() {
    log "Backend: gcloud run deploy --source backend"
    gcloud run deploy "$BACKEND_SERVICE" \
        --source backend \
        --region "$REGION" \
        --project "$PROJECT_ID" \
        --quiet
}

case "$TARGET" in
    all)
        build_addin
        deploy_backend
        deploy_frontend
        ;;
    frontend)
        build_addin
        deploy_frontend
        ;;
    backend)
        deploy_backend
        ;;
    addin)
        build_addin
        ;;
    *)
        echo "Usage: $0 [all|frontend|backend|addin]" >&2
        exit 2
        ;;
esac

log "Done."
echo "  frontend: $(gcloud run services describe "$FRONTEND_SERVICE" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)' 2>/dev/null || echo '?')"
echo "  backend:  $(gcloud run services describe "$BACKEND_SERVICE"  --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)' 2>/dev/null || echo '?')"
echo "  addin:    \${FRONTEND_URL}/word-addin/manifest.xml"
