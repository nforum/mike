/**
 * Idempotent schema bootstrap that runs once on backend startup.
 *
 * The repo carries proper SQL migrations under backend/migrations/, but
 * Cloud Run deploys do not have a separate migration step yet. Anything
 * the app *requires to function* and is cheap enough to assert at every
 * cold start lives here, behind `CREATE … IF NOT EXISTS` guards.
 *
 * Treat this file as a safety net, not a replacement for migrations:
 *  - keep statements idempotent (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS),
 *  - do not destructively alter existing data,
 *  - log clearly so a deploy failing on schema is obvious in Cloud Logging.
 */
import { query } from "./db";

const STATEMENTS: ReadonlyArray<{ name: string; sql: string }> = [
    {
        name: "auth_pair_codes",
        sql: `
            CREATE TABLE IF NOT EXISTS public.auth_pair_codes (
              code        TEXT PRIMARY KEY,
              user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
              token       TEXT NOT NULL,
              attempts    INT  NOT NULL DEFAULT 0,
              expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
              created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        `,
    },
    {
        name: "auth_pair_codes_expires_at_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS auth_pair_codes_expires_at_idx
                ON public.auth_pair_codes (expires_at);
        `,
    },
    {
        name: "auth_pair_codes_user_id_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS auth_pair_codes_user_id_idx
                ON public.auth_pair_codes (user_id);
        `,
    },
    {
        // The Word add-in's Office.js WebView is sandboxed away from the
        // browser cookies the web frontend uses for next-intl's
        // NEXT_LOCALE, so it has to fetch the locale from the user
        // profile instead. Defaults to "hr" to match
        // frontend/src/i18n/request.ts. Idempotent.
        name: "user_profiles.preferred_language",
        sql: `
            ALTER TABLE public.user_profiles
                ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'hr';
        `,
    },
    // NOTE: An earlier iteration provisioned `projects.web_search_sources`
    // here for per-project source-key allowlists. That responsibility
    // moved to backend/src/lib/search/search_config.json (declarative,
    // edit + redeploy) so the column is no longer read by the app. The
    // column is intentionally left in place for any tenants that may
    // already store data there — drop in a follow-up migration once we
    // confirm no one depends on it.
    {
        // Native file-source connectors (Google Drive / OneDrive / Box).
        // Mirrors backend/migrations/108_integration_accounts.sql.
        // Tokens stored encrypted via lib/crypto.encryptApiKey().
        name: "integration_accounts",
        sql: `
            CREATE TABLE IF NOT EXISTS public.integration_accounts (
                id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id         uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                provider        text        NOT NULL CHECK (provider IN ('google_drive', 'onedrive', 'box')),
                account_email   text,
                account_name    text,
                access_token    text        NOT NULL,
                refresh_token   text,
                token_type      text        DEFAULT 'Bearer',
                expires_at      timestamptz,
                scopes          text[]      DEFAULT ARRAY[]::text[],
                created_at      timestamptz NOT NULL DEFAULT now(),
                updated_at      timestamptz NOT NULL DEFAULT now(),
                UNIQUE (user_id, provider)
            );
        `,
    },
    {
        name: "integration_accounts_user_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS idx_integration_accounts_user
                ON public.integration_accounts (user_id);
        `,
    },
    {
        // Provenance on imported documents — lets the UI show
        // "Imported from Google Drive" and detect drift on re-import.
        name: "documents.source_columns",
        sql: `
            ALTER TABLE public.documents
                ADD COLUMN IF NOT EXISTS source_provider     text,
                ADD COLUMN IF NOT EXISTS source_external_id  text,
                ADD COLUMN IF NOT EXISTS source_revision     text,
                ADD COLUMN IF NOT EXISTS source_imported_at  timestamptz;
        `,
    },
    {
        name: "documents_source_external_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS idx_documents_source_external
                ON public.documents (user_id, source_provider, source_external_id)
                WHERE source_external_id IS NOT NULL;
        `,
    },
    {
        // Email-bound share invites for chats. Mirrors
        // backend/migrations/109_chat_shares.sql. The accept handler
        // appends the recipient's email to chats.shared_with so the
        // existing chat.ts access check sees them as collaborators.
        name: "chat_shares",
        sql: `
            CREATE TABLE IF NOT EXISTS public.chat_shares (
                id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
                chat_id             uuid        NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
                shared_by_user_id   uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                shared_with_email   text        NOT NULL,
                token_hash          text        NOT NULL UNIQUE,
                snapshot_at         timestamptz NOT NULL DEFAULT now(),
                expires_at          timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
                accepted_at         timestamptz,
                accepted_user_id    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
                revoked_at          timestamptz,
                created_at          timestamptz NOT NULL DEFAULT now()
            );
        `,
    },
    {
        name: "chat_shares_chat_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS idx_chat_shares_chat
                ON public.chat_shares (chat_id);
        `,
    },
    {
        name: "chat_shares_email_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS idx_chat_shares_email
                ON public.chat_shares (shared_with_email);
        `,
    },
    {
        name: "chat_shares_chat_email_active_uniq",
        sql: `
            CREATE UNIQUE INDEX IF NOT EXISTS chat_shares_chat_email_active_uniq
                ON public.chat_shares (chat_id, shared_with_email)
                WHERE revoked_at IS NULL;
        `,
    },
    {
        name: "chats.shared_with",
        sql: `
            ALTER TABLE public.chats
                ADD COLUMN IF NOT EXISTS shared_with jsonb NOT NULL DEFAULT '[]'::jsonb;
        `,
    },
    {
        name: "chats_shared_with_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS chats_shared_with_idx
                ON public.chats USING gin (shared_with);
        `,
    },
    {
        // Per-message "not appropriate answer" flag — see migration 110.
        // Denormalised boolean on chat_messages keeps the GET /chat reads
        // cheap; the audit table (next entries) holds the toggle history.
        name: "chat_messages.flag_columns",
        sql: `
            ALTER TABLE public.chat_messages
                ADD COLUMN IF NOT EXISTS is_flagged boolean NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS flagged_at timestamptz,
                ADD COLUMN IF NOT EXISTS flagged_by uuid;
        `,
    },
    {
        name: "chat_message_flags",
        sql: `
            CREATE TABLE IF NOT EXISTS public.chat_message_flags (
                id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
                chat_message_id uuid        NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
                chat_id         uuid        NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
                user_id         uuid        NOT NULL,
                action          text        NOT NULL CHECK (action IN ('flag', 'unflag')),
                reason          text,
                created_at      timestamptz NOT NULL DEFAULT now()
            );
        `,
    },
    {
        name: "chat_message_flags_message_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS idx_chat_message_flags_message
                ON public.chat_message_flags (chat_message_id);
        `,
    },
    {
        name: "chat_message_flags_chat_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS idx_chat_message_flags_chat
                ON public.chat_message_flags (chat_id);
        `,
    },
    {
        name: "chat_messages_flagged_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS idx_chat_messages_flagged
                ON public.chat_messages (chat_id)
                WHERE is_flagged = true;
        `,
    },
    {
        // Per-user override for built-in MCP connectors loaded from
        // mike/mcp.json. Absent row = default-enabled. See migration 111.
        // The composite PK lets us upsert on (user_id, slug) without an
        // extra unique index.
        name: "user_mcp_builtin_prefs",
        sql: `
            CREATE TABLE IF NOT EXISTS public.user_mcp_builtin_prefs (
                user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                slug        text        NOT NULL,
                enabled     boolean     NOT NULL,
                created_at  timestamptz NOT NULL DEFAULT now(),
                updated_at  timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (user_id, slug)
            );
        `,
    },
    {
        name: "user_mcp_builtin_prefs_user_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS idx_user_mcp_builtin_prefs_user
                ON public.user_mcp_builtin_prefs (user_id);
        `,
    },
    {
        // Per-request LLM usage log for cost tracking. See migration 112.
        // Anthropic returns authoritative token counts; USD is computed
        // in app code from the published Sonnet 4.6 rates.
        name: "llm_usage",
        sql: `
            CREATE TABLE IF NOT EXISTS public.llm_usage (
                id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id                     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                provider                    text        NOT NULL,
                model                       text        NOT NULL,
                chat_id                     uuid,
                project_id                  uuid,
                chat_message_id             uuid,
                project_chat_message_id     uuid,
                iterations                  int         NOT NULL DEFAULT 1,
                input_tokens                int         NOT NULL DEFAULT 0,
                output_tokens               int         NOT NULL DEFAULT 0,
                cache_creation_input_tokens int         NOT NULL DEFAULT 0,
                cache_read_input_tokens     int         NOT NULL DEFAULT 0,
                cost_usd                    numeric(12, 6) NOT NULL DEFAULT 0,
                duration_ms                 int,
                status                      text        NOT NULL DEFAULT 'ok'
                                                        CHECK (status IN ('ok', 'error', 'aborted')),
                error_message               text,
                created_at                  timestamptz NOT NULL DEFAULT now()
            );
        `,
    },
    {
        name: "llm_usage_user_created_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS idx_llm_usage_user_created
                ON public.llm_usage (user_id, created_at DESC);
        `,
    },
    {
        name: "llm_usage_chat_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS idx_llm_usage_chat
                ON public.llm_usage (chat_id, created_at DESC)
                WHERE chat_id IS NOT NULL;
        `,
    },
    {
        name: "llm_usage_model_created_idx",
        sql: `
            CREATE INDEX IF NOT EXISTS idx_llm_usage_model_created
                ON public.llm_usage (model, created_at DESC);
        `,
    },
];

// Errors that indicate the connection itself died (Cloud SQL Auth Proxy
// hiccup, IAM token refresh race, idle drop). Retrying these against a
// fresh pooled connection almost always succeeds; we should not give up
// after a single attempt because the statement is idempotent.
const TRANSIENT_PATTERNS = [
    /connection terminated/i,
    /connection reset/i,
    /timeout/i,
    /ECONNRESET/,
    /ECONNREFUSED/,
    /server closed the connection/i,
];

function isTransient(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return TRANSIENT_PATTERNS.some((re) => re.test(msg));
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyWithRetry(
    name: string,
    sql: string,
    maxAttempts = 5,
): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await query(sql);
            if (attempt > 1) {
                console.log(
                    `[ensureSchema] '${name}' applied on attempt ${attempt}`,
                );
            }
            return;
        } catch (err) {
            lastErr = err;
            const transient = isTransient(err);
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(
                `[ensureSchema] '${name}' attempt ${attempt}/${maxAttempts} failed (${transient ? "transient" : "permanent"}): ${msg}`,
            );
            if (!transient) break;
            // Exponential backoff: 250ms, 500ms, 1s, 2s — well under the
            // 10s Cloud Run startup probe so the listener stays healthy.
            await sleep(250 * 2 ** (attempt - 1));
        }
    }
    console.error(
        `[ensureSchema] giving up on '${name}':`,
        lastErr instanceof Error ? lastErr.message : lastErr,
    );
}

export async function ensureSchema(): Promise<void> {
    for (const stmt of STATEMENTS) {
        await applyWithRetry(stmt.name, stmt.sql);
    }
    console.log("[ensureSchema] done");
}
