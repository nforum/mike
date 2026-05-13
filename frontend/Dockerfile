# ────────────────────────────────────────────────────────────────
#  MikeOSS Frontend — Cloud Run Dockerfile
#
#  Multi-stage build using Next.js standalone output:
#    1. deps    — install node_modules
#    2. builder — next build (standalone output)
#    3. runner  — minimal runtime (~120 MB)
# ────────────────────────────────────────────────────────────────

# ── Stage 1: Dependencies ───────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: Build ──────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars (public only — NEXT_PUBLIC_*).
#
# CRITICAL — two deploy paths must both work here:
#
#   1. `cloudbuild.yaml` passes --build-arg NEXT_PUBLIC_API_BASE_URL=...
#      so the Cloud Build pipeline can inject the backend URL.
#   2. `scripts/deploy.sh` writes `frontend/.env.production` and passes
#      `--set-build-env-vars` so Cloud Build injects Docker ARG values
#      even if `.env.production` is omitted from the upload (see
#      frontend/.gcloudignore).
#
# The naive `ENV NEXT_PUBLIC_API_BASE_URL=${ARG}` from earlier always
# set the env var — even to an empty string when the ARG wasn't passed.
# Next.js then treats it as "already configured" and SKIPS .env.production
# (platform env vars beat .env files in Next's resolution order). The
# resulting browser bundle had API_BASE = "" and called /chat etc. on
# the frontend origin → 404 page-not-found HTML in every API response.
#
# Fix: only materialize the ARG into a real env var when it's non-empty,
# via .env.production.local (Next.js's highest-priority dotenv file).
# An unset ARG leaves both files untouched and .env.production wins.
ARG NEXT_PUBLIC_API_BASE_URL=""
ARG NEXT_PUBLIC_BACKEND_URL=""
# NOTE: Do not use shell loop vars like `$f` / `$found` here — Docker
# expands `$WORD` in RUN as build-time ARG/ENV before `/bin/sh` runs, so
# unknown names become empty and the guard always fails even when
# `.env.production` is correct (see Cloud Build logs).
RUN if [ -n "$NEXT_PUBLIC_API_BASE_URL" ]; then \
        printf 'NEXT_PUBLIC_API_BASE_URL=%s\n' "$NEXT_PUBLIC_API_BASE_URL" >> .env.production.local; \
    fi && \
    if [ -n "$NEXT_PUBLIC_BACKEND_URL" ]; then \
        printf 'NEXT_PUBLIC_BACKEND_URL=%s\n' "$NEXT_PUBLIC_BACKEND_URL" >> .env.production.local; \
    fi && \
    echo "--- .env.production.local (build-arg overrides) ---" && \
    ( cat .env.production.local 2>/dev/null || echo "(absent — .env.production wins)" ) && \
    echo "--- .env.production (deploy.sh fallback) ---" && \
    ( cat .env.production 2>/dev/null || echo "(absent)" ) && \
    if grep -q '^NEXT_PUBLIC_API_BASE_URL=' .env.production 2>/dev/null; then \
        echo "OK: NEXT_PUBLIC_API_BASE_URL in .env.production"; \
    elif [ -f .env.production.local ] && grep -q '^NEXT_PUBLIC_API_BASE_URL=' .env.production.local 2>/dev/null; then \
        echo "OK: NEXT_PUBLIC_API_BASE_URL in .env.production.local"; \
    else \
        echo "ERROR: NEXT_PUBLIC_API_BASE_URL missing — set build-args or .env.production" >&2; \
        exit 1; \
    fi

# Source .env files into the shell BEFORE `next build` so the values land in
# process.env at the time Next.js evaluates `process.env.NEXT_PUBLIC_*`. This
# defeats a subtle bug where Cloud Run from-source seeds the build container
# with empty `NEXT_PUBLIC_*` shells (matching the ARG name) which then beat
# Next's own .env.production loader (process.env > .env file resolution).
# Symptom we just hit: bundle shipped `"".trim()||"http://localhost:3001"`
# even though .env.production had the Cloud Run URL and Next logged
# `Environments: .env.production`. Exporting first guarantees the right
# string is inlined into client chunks.
RUN set -eu; \
    for f in .env.production.local .env.production; do \
        if [ -f "$f" ]; then \
            echo "--- exporting from $f ---"; \
            set -a; \
            . "./$f"; \
            set +a; \
        fi; \
    done; \
    echo "Build env: NEXT_PUBLIC_API_BASE_URL='${NEXT_PUBLIC_API_BASE_URL:-<unset>}'"; \
    echo "Build env: NEXT_PUBLIC_BACKEND_URL='${NEXT_PUBLIC_BACKEND_URL:-<unset>}'"; \
    if [ -z "${NEXT_PUBLIC_API_BASE_URL:-}" ]; then \
        echo "ERROR: NEXT_PUBLIC_API_BASE_URL empty after sourcing .env files" >&2; \
        exit 1; \
    fi; \
    npm run build

# ── Stage 3: Runtime ────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone server + static assets + public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules/@swc/helpers ./node_modules/@swc/helpers

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
