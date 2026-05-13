# Max

Open-source release containing the Max frontend, backend, and Word add-in.

## Contents

- `frontend/` — Next.js 16 app (App Router, Turbopack, React Compiler)
- `backend/` — Express API, Cloud SQL access, document processing, migrations
- `word-addin/` — Microsoft Word task pane that talks to the same backend
  (see `word-addin/README.md`)
- `vanjske_datoteke/` — third-party glue (WordPress plugins for the
  eulex.ai identity provider — `eulex-mcp-oauth.php` and
  `eulex-social-auth.php`); these live on the eulex WP install, not here
- `backend/migrations/000_one_shot_schema.sql` — one-shot schema for
  fresh databases; `001_…`, `100_…`, `1NN_…` are incremental on top
- `scripts/deploy.sh` — one-shot Cloud Run deploy from a laptop
- `cloudbuild.yaml` — managed CI pipeline alternative to `deploy.sh`

## Local development

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
npm install --prefix word-addin   # only if you plan to use the add-in
```

Local env files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Apply schema. For a fresh DB run `backend/migrations/000_one_shot_schema.sql`
in the SQL editor; for an existing one apply numbered migrations in order.
The most recent are:

- `102_align_document_edits.sql` — adds `change_id` and FK constraints
  to `document_edits`. Without it, `[dbShim] insert on "document_edits"
  failed: column "change_id" of relation "document_edits" does not exist`
  surfaces as the user-visible "Failed to record edits."
- `103_align_with_canonical.sql` — aligns the rest of the tables with
  `000_one_shot_schema.sql` idempotently
- `104_add_user_profile_cols.sql` — extra profile columns
- `105_auth_pair_codes.sql` — required for Word add-in pairing flow

Run:

```bash
npm run dev --prefix backend     # http://localhost:3001
npm run dev --prefix frontend    # http://localhost:3000
```

## Word add-in (optional)

```bash
cd word-addin
npm install
npm run install-certs   # one-time, self-signed Office cert
npm run dev             # taskpane on https://localhost:3002
```

Sideload `word-addin/manifest.xml` in Word, then pair from
`Account → Word add-in` (6-digit code, 5-minute TTL).

For production builds, `npm run build` inside `word-addin/` emits the
bundle into `frontend/public/word-addin/`, served by Next.js.

## Required services

- PostgreSQL (Cloud SQL in production, Supabase or local PG in dev)
- S3-compatible object storage (Cloudflare R2 in dev, GCS in production)
- At least one model provider key (see "LLM configuration" below)
- LibreOffice (DOC/DOCX → PDF conversion)
- WordPress + Ultimate Membership Pro on `eulex.ai` for the identity
  provider; `vanjske_datoteke/eulex-mcp-oauth.php` runs there as the
  OAuth 2.1 Authorization Server with DCR + PKCE

## LLM configuration

Backend reads provider keys from `backend/.env`:

### Provider keys

- `GEMINI_API_KEY` — Google Gemini
- `ANTHROPIC_API_KEY` — Anthropic Claude
- `OPENROUTER_API_KEY` — OpenRouter (multi-provider)
- `RESEND_API_KEY` — Resend (email)

### Self-hosted vLLM

- `VLLM_BASE_URL` — vLLM server base URL (e.g. `https://your-vllm/v1`)
- `VLLM_API_KEY` — vLLM API key
- `VLLM_MAIN_MODEL` — primary model name (e.g. `BredaAI`)
- `VLLM_LIGHT_MODEL` — lightweight model for quick responses

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint  --prefix frontend
```

## License

AGPL-3.0-only. See `LICENSE`.

---

# Production deployment (GCP / Cloud Run)

The two services run on Cloud Run in `mikeoss-495610` /
`europe-west1`:

| Service | Stable URL | Project URL (immutable) |
|---|---|---|
| `mike-frontend` | `https://mike-frontend-516192556389.europe-west1.run.app` | `https://mike-frontend-cc6nrgescq-ew.a.run.app` |
| `mike-backend` | `https://mike-backend-516192556389.europe-west1.run.app` | `https://mike-backend-cc6nrgescq-ew.a.run.app` |

Cloud SQL PostgreSQL is reachable both via Cloud SQL Connector (private,
IAM auth) and via Cloud SQL Proxy from a laptop:

```bash
cloud-sql-proxy mikeoss-495610:europe-west1:<instance> --port 5433
psql -h 127.0.0.1 -p 5433 -U <user> -d mike
```

## One-shot deploy from a laptop

```bash
# Defaults already point at the right service names + URLs; override only
# if your project differs.
export PROJECT_ID=mikeoss-495610
export REGION=europe-west1
export FRONTEND_URL=https://mike-frontend-cc6nrgescq-ew.a.run.app
export BACKEND_URL=https://mike-backend-cc6nrgescq-ew.a.run.app

./scripts/deploy.sh             # backend + frontend + add-in
./scripts/deploy.sh frontend    # frontend (also rebuilds add-in into it)
./scripts/deploy.sh backend     # backend only
./scripts/deploy.sh addin       # only rebuild Word add-in into frontend/public
```

`deploy.sh frontend`:

1. Rebuilds the Word add-in with `ADDIN_URL=$FRONTEND_URL` and
   `API_BASE_URL=$BACKEND_URL`, emitting into `frontend/public/word-addin/`.
2. Writes `frontend/.env.production` with the two `NEXT_PUBLIC_*` vars
   so Next.js inlines them at build time, then deletes it on exit.
3. Runs `gcloud run deploy --source frontend` with
   `--set-build-env-vars` as a belt-and-suspenders fallback.

`deploy.sh backend`: plain `gcloud run deploy --source backend`.

## CI alternative

`cloudbuild.yaml` exists for `gcloud builds submit --config=cloudbuild.yaml`.
It does the same docker build with explicit `--build-arg
NEXT_PUBLIC_API_BASE_URL=...` for the frontend image.

---

# Operational fix history (May 2026)

This section records the non-obvious failures hit in production and how
they were resolved, so the next person hitting the same symptom doesn't
have to re-derive the cause from logs.

## 1. "Failed to record edits." on every chat edit

**Symptom**

```
[dbShim] insert on "document_edits" failed:
  column "change_id" of relation "document_edits" does not exist
```

UI showed *Edit failed* on every `edit_document` LLM tool call.

**Cause** Cloud SQL diverged from `000_one_shot_schema.sql`. New columns
(`change_id`, FK to `documents`) were missing.

**Fix** Wrote two idempotent migrations and applied them via Cloud SQL
Proxy:

- `backend/migrations/102_align_document_edits.sql`
- `backend/migrations/103_align_with_canonical.sql`

```bash
cloud-sql-proxy mikeoss-495610:europe-west1:<instance> --port 5433 &
psql -h 127.0.0.1 -p 5433 -U <user> -d mike -f backend/migrations/102_align_document_edits.sql
psql -h 127.0.0.1 -p 5433 -U <user> -d mike -f backend/migrations/103_align_with_canonical.sql
```

## 2. CORS error masking 502 on `/single-documents/.../docx`

**Symptom**

```
Access to fetch at 'https://mike-backend.../docx?version_id=...' from
origin 'https://mike-frontend...' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested
resource.
```

**Cause** Two layers of trouble:

1. Cloud Run scaled `mike-backend` to zero. Cold-start latency tripped a
   timeout and Cloud Run's edge returned a 502 with no CORS headers, so
   Chrome blamed CORS for what was really a 5xx.
2. Even on warm starts, an unhandled exception in the route handler
   produced a default Express error page without CORS headers.

**Fix**

- `gcloud run services update mike-backend --min-instances=1` to keep
  one warm instance.
- `backend/src/index.ts` now installs:
  - a global middleware that writes `Access-Control-Allow-Origin` /
    `Access-Control-Allow-Credentials` / `Vary: Origin` on every
    response *before* routing, so they survive `throw` in a route;
  - a catch-all 404 inside Express (so unknown paths still get CORS);
  - a global error handler that converts thrown errors into JSON 500
    with CORS headers attached;
  - `process.on('unhandledRejection' | 'uncaughtException', …)` for
    log breadcrumbs.
- `backend/src/routes/documents.ts` got diagnostic logging at the
  `documents not found` / `GCS miss` / `version not found` branches so
  the next "404 looks like CORS" is one log line away from triage.

## 3. Frontend bundle calling `http://localhost:3001` in production

**Symptom**

```
GET http://localhost:3001/projects net::ERR_FAILED
… No 'Access-Control-Allow-Origin' header …
```

across `/projects`, `/chat`, `/user/profile`, `/user/mcp-servers`,
`/auth/pair/start`. Production frontend was hitting localhost.

**Cause (the deep one)** Next.js 16 + Turbopack inlines
`process.env.NEXT_PUBLIC_*` at build time. `process.env` beats `.env*`
files in Next's resolution order. Cloud Run "deploy from source" seeded
the build container with **empty** `NEXT_PUBLIC_API_BASE_URL` (matching
the `ARG` declared in the Dockerfile) which then preempted Next's own
`.env.production` loader. The build log lied — it said
`Environments: .env.production` (file was loaded) yet the bundle
shipped `a="".trim()||"http://localhost:3001"` (process.env value won,
empty string beat the file's URL).

The earlier failure mode that motivated the current Dockerfile was the
same family: `ENV NEXT_PUBLIC_API_BASE_URL=${ARG}` always exported the
ARG, even as `""` when no `--build-arg` was passed, so Next inlined `""`
in client code → `API_BASE = ""` → every call routed to the *frontend*
origin (`fetch("/chat")`) and got back the Next.js HTML page.

**Fix (`frontend/Dockerfile`, stage 2)**

1. Don't `ENV` the build args directly — only mirror them into
   `.env.production.local` if the ARG is non-empty (so `.env.production`
   from `deploy.sh` wins when the ARG isn't passed).
2. Right before `npm run build`, source `.env.production[.local]` into
   the shell environment with `set -a; . ./.env.production; set +a` so
   the values are present in the actual `process.env` Next.js evaluates
   at inline time. Belt-and-suspenders error if the var is empty.
3. Print both files for build-log diagnosability.

The `RUN` step that did the env-presence check originally used `$$f` /
`$$found` shell loop variables. Docker expands `$WORD` in `RUN` as
build-time ARG/ENV before `/bin/sh` ever runs, so unknown names became
empty and the guard always failed. Replaced the loop with two literal
`grep -q` checks.

**Fix (`scripts/deploy.sh`)**

```bash
log "Frontend: writing .env.production with NEXT_PUBLIC_API_BASE_URL=$BACKEND_URL"
cat > frontend/.env.production <<EOF
NEXT_PUBLIC_API_BASE_URL=$BACKEND_URL
NEXT_PUBLIC_BACKEND_URL=$BACKEND_URL
EOF
trap 'rm -f frontend/.env.production' EXIT

gcloud run deploy "$FRONTEND_SERVICE" --source frontend \
    --region "$REGION" --project "$PROJECT_ID" \
    --set-build-env-vars "NEXT_PUBLIC_API_BASE_URL=${BACKEND_URL},NEXT_PUBLIC_BACKEND_URL=${BACKEND_URL}" \
    --quiet
```

**Fix (`frontend/.gcloudignore` + root `.gcloudignore`)**

`gcloud run deploy --source frontend` packages paths *relative to
`frontend/`*, so the root `!frontend/.env.production` rule never matches.
Added `frontend/.gcloudignore` with explicit `!.env.production` and a
failsafe `!**/.env.production` at the root.

**Verification** Curl one of the deployed chunks and look for the
backend URL string:

```bash
curl -s 'https://mike-frontend-516192556389.europe-west1.run.app/_next/static/chunks/<hash>.js' \
  | grep -oE 'https://mike-backend[a-z0-9.-]+\.run\.app' | head -1
# → https://mike-backend-cc6nrgescq-ew.a.run.app
```

If the chunk only contains `localhost:3001`, the env var did not get
inlined and Step 3 above broke again.

## 4. `@swc/helpers` lockfile drift, `npm ci` fails in Cloud Build

**Symptom** Cloud Build step `RUN npm ci` failed with peer-dep mismatch:
`next` pinned `@swc/helpers@0.5.15`, `next-intl`'s transitive
`@swc/core` required `>=0.5.17`. Local `npm install` was lenient,
Cloud Build's `npm ci` was not.

**Fix** Added an `overrides` block to `frontend/package.json`:

```json
"overrides": {
    "@swc/helpers": "0.5.21"
}
```

then regenerated `package-lock.json` (`rm package-lock.json && npm install`)
and committed the new lockfile. After that `npm ci` resolves cleanly.

## 5. Eulex MCP connector loses registration after Cloud Run scale-to-zero

**Symptom** "Client Not Registered" on second connect attempt to
`mcp.eulex.ai`. First connect worked; after the eulex MCP service
scaled to zero and back, the same client_id was rejected.

**Cause** `mcp.eulex.ai` (a Python Cloud Run service) stored DCR
registrations in **process memory**. Scale-to-zero wiped them; the
returning instance had no record of the client_id Max was sending.

**Fix (workarounds shipped in this repo)**

- `backend/src/routes/mcpServers.ts` — when token exchange fails with
  `invalid_client`, automatically re-run DCR with the same metadata
  and retry once before surfacing the error to the UI.
- New `POST /user/mcp-servers/:id/reauth` that nukes stored
  `oauth_metadata` / `oauth_tokens` / `oauth_code_verifier` and forces a
  full re-registration on next use.
- Frontend `frontend/src/app/(pages)/account/mcp/page.tsx` exposes a
  "Reset OAuth" button that calls the above endpoint.

**Pending (eulex side)** Migrate DCR + token storage in
`mcp.eulex.ai` from in-memory to Firestore or Cloud SQL. Until then,
expect the occasional re-pair after long idle.

## 6. eulex.ai login (`/authorize`) loses PKCE during social-login bounce

**Symptom** Going from Max → eulex.ai → "Sign in with Google" →
back to `/authorize` failed with *"PKCE required. code_challenge with
S256 method is mandatory."* Direct username/password login worked.

**Cause** Nextend Social Login's redirect_to handling truncated query
parameters. Max's PKCE `code_challenge`, `client_id` and `state`
disappeared between the round trip.

**Fix (`vanjske_datoteke/eulex-mcp-oauth.php`)** Before redirecting an
unauthenticated user to `/signin/`, the plugin now stashes the entire
`$_GET` payload into a WordPress transient keyed by a short
`mcp_resume` token (15-min TTL), and only that token rides the
`redirect_to` URL. On the way back, `/authorize` recognises
`?mcp_resume=…`, restores the original query string from the transient,
and bounces to a clean `/authorize?<full original query>` so the
consent screen and downstream PKCE checks see the real values.

A complementary HttpOnly cookie (`eulex_mcp_resume`) was also added as
a failsafe for the case where even the `mcp_resume` query param is
stripped — but the read-side counterpart is not yet wired into the
plugin (see "Pending" below).

## 7. Connector "Delete" dialog flickered and never confirmed

**Symptom** Clicking *Delete* on an MCP connector flashed a confirm
dialog and dismissed it before the click registered. Network never
fired.

**Cause** Browser's native `confirm()` was being suppressed by Chrome's
"don't show again" auto-block for the origin.

**Fix** Replaced every `window.confirm()` in the MCP connector flow
with the in-app modal `frontend/src/app/components/modals/confirm-dialog.tsx`.

## 8. "Owner-only action" on a chat the user thought was theirs

**Symptom** Logged in as `bplese@gmail.com`, deleting a chat returned
`Owner-only action`.

**Cause** WordPress had two distinct accounts that both authenticated
through the same Google identity in different flows:

| WP user_id | email | DB user_id |
|---|---|---|
| 1 | `info@eulex.ai` | `fc4b351d-…` |
| 35 | `bplese@gmail.com` | `9944fd29-…` |

A handful of chats and one document still had `user_id =
fc4b351d-…` from before the second account was created.

**Fix (one-time SQL)** Reassigned ownership for the affected rows
(`backend/reassign.mjs`) — 2 chats, 1 document moved from
`fc4b351d-…` to `9944fd29-…`. The `Test Project` was kept owned by
`info@eulex.ai` and `bplese@gmail.com` was added to its `shared_with`
JSONB array via `backend/share_project.mjs`. The first version of
`share_project.mjs` failed with `COALESCE types jsonb and text[]
cannot be matched`; the working query uses `|| to_jsonb(ARRAY[$2::text])`
and the `?` operator for membership.

**Pending (eulex side)** Update `vanjske_datoteke/eulex-social-auth.php`
to look up an existing WP user by email *before* creating a new one
on Google login, so the two-accounts-for-one-human case can't recur.

## 9. (CURRENT) Word add-in pairing UI shows raw HTML

**Symptom** Account → Word add-in generates the pairing code OK; the
**add-in side** in Word renders the 6 input boxes but underneath them
shows a wall of raw HTML starting with
`<!DOCTYPE html><html lang="hr">...` and references to
`/_next/static/chunks/...`. Pairing never completes.

**Cause** Production `taskpane.bundle.js` was built without
`API_BASE_URL` set in the build environment. `dotenv-webpack` with
`systemvars: true` in `word-addin/webpack.config.js` only inlines what
it can read at build time, so `process.env.API_BASE_URL` was replaced
with `undefined`. The runtime fallback in
`word-addin/src/taskpane/lib/auth.ts`:

```ts
function defaultApiBase(): string {
    if (typeof window !== "undefined" && window.location?.origin) {
        return window.location.origin;
    }
    return "http://localhost:3001";
}
export const API_BASE = process.env.API_BASE_URL?.trim() || defaultApiBase();
```

then returned `window.location.origin`, which is the **frontend**
Cloud Run URL (the bundle is served from `<frontend>/word-addin/...`).
The add-in then POSTed `/auth/pair/redeem` and `/auth/pair/start` to
`mike-frontend-...`, which has no such Express routes; Next.js answered
with the SPA's HTML shell, the add-in's `res.text()` rendered as the
visible HTML soup.

**Fix** `scripts/deploy.sh` `build_addin()` now exports
`API_BASE_URL=$BACKEND_URL` for the webpack build and verifies the URL
appears in `taskpane.bundle.js` before letting the deploy proceed:

```bash
ADDIN_URL="$FRONTEND_URL" API_BASE_URL="$BACKEND_URL" npm run build
# …
if ! grep -q "$BACKEND_URL" frontend/public/word-addin/taskpane.bundle.js; then
    echo "ERROR: taskpane.bundle.js does not contain BACKEND_URL=$BACKEND_URL" >&2
    exit 1
fi
```

After the next `./scripts/deploy.sh frontend` (or `addin`) the bundle
will hard-code the backend URL. Word users must remove the add-in and
re-sideload the manifest (or restart Word) so Office picks up the new
bundle hash.

**Verification** From a shell:

```bash
curl -s https://mike-frontend-516192556389.europe-west1.run.app/word-addin/taskpane.bundle.js \
    | grep -oE 'https://mike-backend[a-z0-9.-]+\.run\.app' | head -1
# → https://mike-backend-cc6nrgescq-ew.a.run.app
```

In Word, the pairing screen should now show 6 empty input boxes and
nothing else; entering the code should hit
`POST https://mike-backend-…/auth/pair/redeem` (visible in Edge/Chrome
Office DevTools → Network) and return JSON.

---

# Pending follow-ups

| # | Where | What |
|---|---|---|
| 1 | `vanjske_datoteke/eulex-mcp-oauth.php` (uncommitted +14 lines) | Add the `eulex_mcp_resume` cookie *read* path in the `/authorize` handler so the failsafe cookie added in the working copy actually gets used. Then upload to the eulex.ai WP install. |
| 2 | `vanjske_datoteke/eulex-social-auth.php` | Look up existing WP user by email before creating a new one on Google/LinkedIn login. Prevents future "two accounts for one human" cases like fix #8 above. |
| 3 | `mcp.eulex.ai` (Python service, not in this repo) | Persist DCR registrations + tokens to Firestore or Cloud SQL so connector pairing survives scale-to-zero. Max-side workarounds in fix #5 stay as a safety net. |
| 4 | Word add-in | Verify fix #9 end-to-end with a real Word client after the next frontend deploy. |
