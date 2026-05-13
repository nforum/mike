// Built-in (server-side) MCP server loader.
//
// Reads MCP server definitions from a JSON file on disk and exposes them to
// every chat request — identical wire format to user-configured connectors
// (loaders return the same `LoadedMcpServer` shape), but **never** persisted
// to Postgres and **never** surfaced via /user/mcp-servers. They show up
// only as additional tools in the LLM's tool list.
//
// Lookup order (first match wins):
//   1. process.env.MIKE_MCP_CONFIG  (absolute path)
//   2. <cwd>/mike/mcp.json
//   3. <cwd>/../mike/mcp.json     (backend started from `backend/`)
//   4. /app/mike/mcp.json         (Docker default)
//
// The file is reparsed lazily when its mtime changes, so an operator can edit
// `mike/mcp.json` and the change picks up on the next chat request — no
// process restart needed.

import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import type { OpenAIToolSchema } from "../llm/types";
import { McpHttpClient } from "./client";
import { prefixedToolName } from "./servers";
import type { LoadedMcpServer, McpServerRow } from "./types";

const SLUG_RE = /^[a-z0-9_-]{1,20}$/;
const BUILTIN_SLUG_PREFIX = "sys-";
const ENV_VAR_RE = /\$\{([A-Z0-9_]+)\}/g;

type BuiltinMcpEntry = {
    name?: string;
    url: string;
    headers?: Record<string, string>;
    enabled?: boolean;
};

type BuiltinMcpFile = {
    mcpServers?: Record<string, BuiltinMcpEntry>;
};

type ParsedEntry = {
    slug: string;
    name: string;
    url: string;
    headers: Record<string, string>;
};

type Cache = {
    path: string;
    mtimeMs: number;
    entries: ParsedEntry[];
};

let cache: Cache | null = null;
let missLogged = false;

function candidatePaths(): string[] {
    const out: string[] = [];
    const fromEnv = process.env.MIKE_MCP_CONFIG?.trim();
    if (fromEnv) out.push(fromEnv);
    const cwd = process.cwd();
    out.push(path.join(cwd, "mike", "mcp.json"));
    out.push(path.join(cwd, "..", "mike", "mcp.json"));
    out.push("/app/mike/mcp.json");
    return out;
}

async function resolveConfigPath(): Promise<string | null> {
    for (const p of candidatePaths()) {
        try {
            const st = await fs.stat(p);
            if (st.isFile()) return p;
        } catch {
            /* not present — try next */
        }
    }
    return null;
}

function substituteEnv(value: string, ctx: string): string {
    return value.replace(ENV_VAR_RE, (_match, name: string) => {
        const v = process.env[name];
        if (v === undefined) {
            console.warn(
                `[mcp-builtin] env var \${${name}} referenced by ${ctx} is not set; substituting empty string`,
            );
            return "";
        }
        return v;
    });
}

function validateUrl(raw: string): boolean {
    try {
        const u = new URL(raw);
        if (u.protocol === "https:") return true;
        if (
            u.protocol === "http:" &&
            (u.hostname === "localhost" || u.hostname === "127.0.0.1")
        ) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

function parseFile(raw: string, sourcePath: string): ParsedEntry[] {
    let json: BuiltinMcpFile;
    try {
        json = JSON.parse(raw) as BuiltinMcpFile;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[mcp-builtin] failed to parse ${sourcePath}: ${msg}`);
        return [];
    }
    const servers = json.mcpServers;
    if (!servers || typeof servers !== "object") return [];

    const out: ParsedEntry[] = [];
    for (const [rawKey, entry] of Object.entries(servers)) {
        if (!entry || typeof entry !== "object") continue;
        if (entry.enabled === false) continue;

        const key = rawKey.trim().toLowerCase();
        if (!SLUG_RE.test(key)) {
            console.warn(
                `[mcp-builtin] skipping '${rawKey}' — slug must match ${SLUG_RE} (1–20 chars, lowercase)`,
            );
            continue;
        }

        if (typeof entry.url !== "string" || !entry.url.trim()) {
            console.warn(
                `[mcp-builtin] skipping '${rawKey}' — missing or empty 'url'`,
            );
            continue;
        }
        const url = substituteEnv(entry.url.trim(), `${rawKey}.url`);
        if (!validateUrl(url)) {
            console.warn(
                `[mcp-builtin] skipping '${rawKey}' — url '${url}' must use https (or http://localhost)`,
            );
            continue;
        }

        const headers: Record<string, string> = {};
        if (entry.headers && typeof entry.headers === "object") {
            for (const [hk, hv] of Object.entries(entry.headers)) {
                if (typeof hv !== "string") continue;
                headers[hk] = substituteEnv(hv, `${rawKey}.headers.${hk}`);
            }
        }

        const name = (typeof entry.name === "string" && entry.name.trim()) || key;

        out.push({
            slug: `${BUILTIN_SLUG_PREFIX}${key}`,
            name,
            url,
            headers,
        });
    }
    return out;
}

async function loadConfig(): Promise<ParsedEntry[]> {
    const resolved = await resolveConfigPath();
    if (!resolved) {
        if (!missLogged) {
            console.info(
                "[mcp-builtin] no built-in MCP config found (looked at MIKE_MCP_CONFIG, ./mike/mcp.json, ../mike/mcp.json, /app/mike/mcp.json)",
            );
            missLogged = true;
        }
        cache = null;
        return [];
    }
    missLogged = false;

    const st = await fs.stat(resolved);
    if (cache && cache.path === resolved && cache.mtimeMs === st.mtimeMs) {
        return cache.entries;
    }

    const raw = await fs.readFile(resolved, "utf8");
    const entries = parseFile(raw, resolved);
    cache = { path: resolved, mtimeMs: st.mtimeMs, entries };
    console.info(
        `[mcp-builtin] loaded ${entries.length} server(s) from ${resolved}`,
    );
    return entries;
}

/**
 * Construct a minimal `McpServerRow` for a built-in entry. Most fields are
 * never read after loading (the chat dispatcher only touches `row.name`,
 * `row.slug`, and `row.url`), so we fill the rest with safe stubs and a
 * deterministic synthetic `id` derived from the slug.
 */
function stubRow(e: ParsedEntry): McpServerRow {
    const id =
        "builtin-" +
        createHash("sha256").update(e.slug).digest("hex").slice(0, 16);
    return {
        id,
        user_id: "__builtin__",
        slug: e.slug,
        name: e.name,
        url: e.url,
        headers: e.headers,
        enabled: true,
        last_error: null,
        auth_type: "headers",
        oauth_metadata: null,
        oauth_tokens: null,
        oauth_code_verifier: null,
    };
}

/**
 * Open Streamable-HTTP clients for every enabled built-in server, list their
 * tools, and return them in Max's standard `LoadedMcpServer` shape so the
 * chat handler can concatenate them with the per-user connectors.
 *
 * Failures are isolated per server: a misbehaving builtin logs a warning and
 * is dropped from the result; the rest still load. Never throws.
 */
export async function loadBuiltinMcpServers(): Promise<LoadedMcpServer[]> {
    let entries: ParsedEntry[];
    try {
        entries = await loadConfig();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[mcp-builtin] config load failed: ${msg}`);
        return [];
    }
    if (entries.length === 0) return [];

    const settled = await Promise.allSettled(
        entries.map(async (e) => {
            const client = new McpHttpClient(e.url, e.headers);
            await client.connect();
            const mcpTools = await client.listTools();
            const row = stubRow(e);
            const tools: OpenAIToolSchema[] = [];
            const toolNameMap = new Map<string, string>();
            for (const t of mcpTools) {
                const prefixed = prefixedToolName(row.slug, t.name);
                toolNameMap.set(prefixed, t.name);
                tools.push({
                    type: "function",
                    function: {
                        name: prefixed,
                        description:
                            `[${row.name}] ${t.description ?? ""}`.trim(),
                        parameters:
                            (t.inputSchema as Record<string, unknown>) ?? {
                                type: "object",
                                properties: {},
                            },
                    },
                });
            }
            const loaded: LoadedMcpServer = {
                row,
                tools,
                toolNameMap,
                client: {
                    callTool: (name, args) => client.callTool(name, args),
                    close: () => client.close(),
                },
            };
            return loaded;
        }),
    );

    const out: LoadedMcpServer[] = [];
    for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        const e = entries[i];
        if (r.status === "fulfilled") {
            out.push(r.value);
        } else {
            const msg =
                r.reason instanceof Error ? r.reason.message : String(r.reason);
            console.warn(
                `[mcp-builtin] failed to load '${e.slug}' (${e.url}): ${msg}`,
            );
        }
    }
    return out;
}
