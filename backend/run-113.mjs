// Idempotent runner for 113_user_reasoning_effort.sql.
// Connects to Cloud SQL via local cloud-sql-proxy on 127.0.0.1:5433 with
// IAM auth (current gcloud user). Falls back to MIKE_OWNER_PW or POSTGRES_PW
// (matches run-110/111/112 pattern) when the IAM user lacks DDL permissions.
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const sql = readFileSync(
    "/Users/bojanplese/Projekti/MikeOSS/mike-main/backend/migrations/113_user_reasoning_effort.sql",
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
    console.log(`[run-113] connected as ${config.user}`);
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("[run-113] migration applied");

    const r1 = await client.query(`
        SELECT column_name, data_type, column_default, is_nullable
          FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='user_profiles'
           AND column_name='reasoning_effort';
    `);
    console.log("[run-113] verify column:", r1.rows[0]);

    const r2 = await client.query(`
        SELECT conname, pg_get_constraintdef(oid) AS def
          FROM pg_constraint
         WHERE conname='user_profiles_reasoning_effort_check';
    `);
    console.log("[run-113] verify check:", r2.rows[0]);

    // Snapshot of values currently in the column so we can confirm the
    // default backfilled cleanly for existing rows.
    const r3 = await client.query(`
        SELECT reasoning_effort, COUNT(*) AS rows
          FROM public.user_profiles
         GROUP BY reasoning_effort
         ORDER BY reasoning_effort;
    `);
    console.log("[run-113] distribution:");
    for (const row of r3.rows) {
        console.log(`    ${String(row.reasoning_effort).padEnd(8)} ${row.rows}`);
    }
} catch (err) {
    console.error("[run-113] failed:", err.message);
    try {
        await client.query("ROLLBACK");
    } catch {}
    process.exit(1);
} finally {
    await client.end();
}
