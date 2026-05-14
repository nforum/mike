// Idempotent runner for 109_chat_shares.sql.
// Connects to Cloud SQL via local cloud-sql-proxy on 127.0.0.1:5433
// as `mike_owner` so the default privileges grant DML to mike_app.
import { Client } from "pg";
import { readFileSync } from "node:fs";

const sql = readFileSync(
    "/Users/bojanplese/Projekti/MikeOSS/mike-main/backend/migrations/109_chat_shares.sql",
    "utf8",
);

const client = new Client({
    host: "127.0.0.1",
    port: 5433,
    user: "mike_owner",
    password: process.env.MIKE_OWNER_PW,
    database: "mike",
});

try {
    await client.connect();
    console.log("[run-109] connected as mike_owner");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("[run-109] migration applied");

    const r1 = await client.query(`
        SELECT to_regclass('public.chat_shares') AS chat_shares,
               (SELECT count(*) FROM information_schema.columns
                  WHERE table_schema='public'
                    AND table_name='chats'
                    AND column_name='shared_with') AS chats_shared_with_col;
    `);
    console.log("[run-109] verify:", r1.rows[0]);

    const r2 = await client.query(`
        SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
        FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name='chat_shares'
        GROUP BY grantee
        ORDER BY grantee;
    `);
    console.log("[run-109] chat_shares grants:");
    for (const row of r2.rows) {
        console.log(`    ${row.grantee.padEnd(40)} ${row.privs}`);
    }
} catch (err) {
    console.error("[run-109] failed:", err.message);
    try {
        await client.query("ROLLBACK");
    } catch {}
    process.exit(1);
} finally {
    await client.end();
}
