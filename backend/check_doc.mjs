import pg from "pg";
const c = new pg.Client({
  host: "127.0.0.1",
  port: 5433,
  database: "mike",
  user: "bojan@plese.io",
  password: "x",
  ssl: false,
});
await c.connect();

console.log("=== document_versions ===");
const r = await c.query(
  "SELECT id, document_id, version_number, storage_path, size_bytes, created_at FROM document_versions WHERE id = $1 OR document_id = $2 ORDER BY version_number",
  ["ad6e57cd-df9c-4dc7-a1f3-f5e355bb752e", "97f7b4a6-7fba-4a23-9b09-98c89d8e5445"],
);
console.table(r.rows);

console.log("=== documents row ===");
const d = await c.query(
  "SELECT id, filename, file_type, current_version_id, user_id, project_id FROM documents WHERE id = $1",
  ["97f7b4a6-7fba-4a23-9b09-98c89d8e5445"],
);
console.table(d.rows);

if (d.rows.length > 0 && d.rows[0].project_id) {
  console.log("=== chats in project ===");
  const ch = await c.query(
    "SELECT id, title, created_at FROM chats WHERE project_id = $1 ORDER BY created_at DESC LIMIT 5",
    [d.rows[0].project_id],
  );
  console.table(ch.rows);
  console.log("=== last 10 chat_messages in those chats ===");
  const m = await c.query(
    `SELECT id, role, chat_id, created_at, length(content) AS clen
     FROM chat_messages
     WHERE chat_id IN (SELECT id FROM chats WHERE project_id = $1)
     ORDER BY created_at DESC LIMIT 10`,
    [d.rows[0].project_id],
  );
  console.table(m.rows);
}
await c.end();
