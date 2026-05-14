// Idempotent runner for 111_user_mcp_builtin_prefs.sql.
// Connects to Cloud SQL via local cloud-sql-proxy on 127.0.0.1:5433 with
// IAM auth (current gcloud user). Falls back to MIKE_OWNER_PW or POSTGRES_PW
// (matches run-110.mjs pattern) when the IAM user lacks DDL permissions.
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const sql = readFileSync(
    "/Users/bojanplese/Projekti/MikeOSS/mike-main/backend/migrations/111_user_mcp_builtin_prefs.sql",
    "utf8",
);

function getAccessToken() {
    return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
}

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
    console.log(`[run-111] connected as ${config.user}`);
    await client.query("BEGIN");
    await client.query(sql);
    // Tables created by `postgres` superuser need explicit DML grants for
    // the runtime mike_app role — same pattern as run-110.
    if (usePostgres) {
        await client.query(`
            GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_mcp_builtin_prefs TO mike_app;
        `);
    }
    await client.query("COMMIT");
    console.log("[run-111] migration applied");

    const r1 = await client.query(`
        SELECT to_regclass('public.user_mcp_builtin_prefs') AS prefs_table,
               (SELECT count(*) FROM information_schema.columns
                  WHERE table_schema='public'
                    AND table_name='user_mcp_builtin_prefs') AS col_count;
    `);
    console.log("[run-111] verify:", r1.rows[0]);

    const r2 = await client.query(`
        SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
        FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name='user_mcp_builtin_prefs'
        GROUP BY grantee
        ORDER BY grantee;
    `);
    console.log("[run-111] user_mcp_builtin_prefs grants:");
    for (const row of r2.rows) {
        console.log(`    ${row.grantee.padEnd(40)} ${row.privs}`);
    }
} catch (err) {
    console.error("[run-111] failed:", err.message);
    try {
        await client.query("ROLLBACK");
    } catch {}
    process.exit(1);
} finally {
    await client.end();
}
