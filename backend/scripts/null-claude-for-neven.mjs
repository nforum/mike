#!/usr/bin/env node
// One-shot fix: clear Neven's user-supplied Claude API key so backend falls
// back to the server-level ANTHROPIC_API_KEY (Secret Manager). This is the
// least-invasive way to make him "use our key" — keeps `safeDecrypt` returning
// null for that column, which is exactly the path serverClaudeKey() handles.
//
// Usage:
//   PGUSER=mike_app PGPASSWORD=... node backend/scripts/null-claude-for-neven.mjs

import { Client } from "pg";

const TARGET = "eeeef244-023f-4886-bd48-b659a325dacf";

const client = new Client({
    host: "127.0.0.1",
    port: 5433,
    database: "mike",
    user: process.env.PGUSER ?? "mike_app",
    password: process.env.PGPASSWORD,
    ssl: false,
});

await client.connect();

const before = await client.query(
    `SELECT user_id, length(claude_api_key) AS len, left(claude_api_key, 8) AS prefix, updated_at
     FROM user_profiles WHERE user_id = $1::uuid`,
    [TARGET],
);
console.log("BEFORE:");
console.table(before.rows);

const upd = await client.query(
    `UPDATE user_profiles
     SET claude_api_key = NULL,
         updated_at     = now()
     WHERE user_id = $1::uuid
     RETURNING user_id, claude_api_key IS NULL AS cleared, updated_at`,
    [TARGET],
);
console.log("UPDATE result:");
console.table(upd.rows);

const after = await client.query(
    `SELECT user_id, length(claude_api_key) AS len, claude_api_key IS NULL AS is_null, updated_at
     FROM user_profiles WHERE user_id = $1::uuid`,
    [TARGET],
);
console.log("AFTER:");
console.table(after.rows);

await client.end();
