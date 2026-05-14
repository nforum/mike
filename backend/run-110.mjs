// Idempotent runner for 110_chat_message_flags.sql.
// Connects to Cloud SQL via local cloud-sql-proxy on 127.0.0.1:5433 with
// IAM auth (current gcloud user). The IAM user needs ALTER permission on
// chat_messages and CREATE on schema public — if that fails, fall back
// to running as mike_owner with MIKE_OWNER_PW (matches run-109.mjs pattern).
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const sql = readFileSync(
    "/Users/bojanplese/Projekti/MikeOSS/mike-main/backend/migrations/110_chat_message_flags.sql",
    "utf8",
);

function getAccessToken() {
    return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
}

// Tables in this DB are owned by `postgres` superuser (see migration
// history — the canonical schema was bootstrapped via Supabase). Only
// the table owner can ALTER, so DDL must run as postgres. The runner
// supports three connection modes, in order of preference:
//   POSTGRES_PW   → connect as built-in `postgres` superuser
//   MIKE_OWNER_PW → connect as built-in `mike_owner`
//   (default)     → IAM auth with the current gcloud user
const usePostgres = !!process.env.POSTGRES_PW;
const useOwner = !usePostgres && !!process.env.MIKE_OWNER_PW;
const config = usePostgres
    ? {
          host: "127.0.0.1",
          port: 5433,
          user: "postgres",
          password: process.env.POSTGRES_PW,
          database: "mike",
      }
    : useOwner
      ? {
            host: "127.0.0.1",
            port: 5433,
            user: "mike_owner",
            password: process.env.MIKE_OWNER_PW,
            database: "mike",
        }
      : {
            host: "127.0.0.1",
            port: 5433,
            user: process.env.IAM_USER || "bplese@gmail.com",
            password: getAccessToken(),
            database: "mike",
            ssl: false,
        };

const client = new Client(config);

try {
    await client.connect();
    console.log(`[run-110] connected as ${config.user}`);
    await client.query("BEGIN");
    await client.query(sql);
    // Migrations executed by `postgres` create tables owned by that
    // superuser; the runtime app role (mike_app) does NOT pick those up
    // through default privileges, so it would 'permission denied' on
    // every INSERT. Grant DML explicitly. Reading from chat_messages and
    // writing the denormalised flag columns also needs SELECT/UPDATE for
    // mike_app on that pre-existing table.
    if (usePostgres) {
        await client.query(`
            GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_message_flags TO mike_app;
            GRANT SELECT, UPDATE ON public.chat_messages TO mike_app;
        `);
    }
    await client.query("COMMIT");
    console.log("[run-110] migration applied");

    const r1 = await client.query(`
        SELECT to_regclass('public.chat_message_flags') AS chat_message_flags_table,
               (SELECT count(*) FROM information_schema.columns
                  WHERE table_schema='public'
                    AND table_name='chat_messages'
                    AND column_name IN ('is_flagged','flagged_at','flagged_by')) AS flag_cols_present;
    `);
    console.log("[run-110] verify:", r1.rows[0]);

    const r2 = await client.query(`
        SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
        FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name='chat_message_flags'
        GROUP BY grantee
        ORDER BY grantee;
    `);
    console.log("[run-110] chat_message_flags grants:");
    for (const row of r2.rows) {
        console.log(`    ${row.grantee.padEnd(40)} ${row.privs}`);
    }
} catch (err) {
    console.error("[run-110] failed:", err.message);
    try {
        await client.query("ROLLBACK");
    } catch {}
    process.exit(1);
} finally {
    await client.end();
}
