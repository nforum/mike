#!/usr/bin/env node
// Diagnostic: classify user_profiles.*_api_key columns by shape so we
// can see who has personal keys, who relies on the server fallback, and
// when those rows were created vs when encryption was introduced.
//
// Usage:
//   PGUSER=mike_readonly PGPASSWORD=... node backend/scripts/diag-claude-keys.mjs
//
// Requires cloud-sql-proxy running on 127.0.0.1:5433 against
// mikeoss-495610:europe-west1:mike-db.

import { Client } from "pg";

const client = new Client({
    host: "127.0.0.1",
    port: 5433,
    database: "mike",
    user: process.env.PGUSER ?? "mike_readonly",
    password: process.env.PGPASSWORD,
    ssl: false,
});

await client.connect();

const TARGET_USER = "eeeef244-023f-4886-bd48-b659a325dacf";

const perUser = await client.query(`
    SELECT
        up.user_id,
        u.email,
        u.created_at::date AS user_created,
        up.updated_at::date AS profile_updated,
        up.tabular_model,
        up.preferred_language,
        up.tier,
        CASE
            WHEN up.claude_api_key IS NULL OR up.claude_api_key = '' THEN 'null'
            WHEN up.claude_api_key ~ '^sk-' THEN 'plaintext_sk'
            WHEN up.claude_api_key ~ '^[A-Za-z0-9+/=]+$' AND length(up.claude_api_key) >= 40 THEN 'encrypted_b64'
            ELSE 'unknown'
        END AS claude_shape,
        length(up.claude_api_key) AS claude_len,
        left(up.claude_api_key, 6) AS claude_prefix
    FROM user_profiles up
    LEFT JOIN users u ON u.id = up.user_id
    ORDER BY u.created_at;
`);
console.log("\n== per-user Claude key state ==");
console.table(perUser.rows);

const target = await client.query(
    `
    SELECT
        up.user_id,
        u.email,
        u.created_at,
        up.created_at AS profile_created,
        up.updated_at AS profile_updated,
        up.tabular_model,
        up.preferred_language,
        length(up.claude_api_key) AS claude_len,
        left(up.claude_api_key, 12) AS claude_prefix,
        up.claude_api_key IS NOT NULL AND up.claude_api_key <> '' AS has_claude_key,
        up.gemini_api_key IS NOT NULL AND up.gemini_api_key <> '' AS has_gemini_key,
        up.openai_api_key IS NOT NULL AND up.openai_api_key <> '' AS has_openai_key,
        up.mistral_api_key IS NOT NULL AND up.mistral_api_key <> '' AS has_mistral_key
    FROM user_profiles up
    LEFT JOIN users u ON u.id = up.user_id
    WHERE up.user_id = $1::uuid;
    `,
    [TARGET_USER],
);
console.log(`\n== target user (${TARGET_USER}) ==`);
console.table(target.rows);

await client.end();
