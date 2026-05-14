/**
 * /adminmax — separate admin portal for billing & usage oversight.
 *
 * Auth model
 * ----------
 * - POST /adminmax/login     (body: { password })  — public, rate-limited
 *                              compare against ADMIN_MAX_PASSWORD env.
 *                              Returns { token, expiresAt } HS256 JWT.
 * - All other /adminmax/*    require Bearer admin token via
 *                              requireAdminMaxAuth middleware.
 *
 * Routes
 * ------
 *   POST  /adminmax/login
 *   GET   /adminmax/users                         — totals across all users
 *   GET   /adminmax/users/:userId                 — totals + meta for one user
 *   GET   /adminmax/users/:userId/usage           — paginated llm_usage rows
 *   GET   /adminmax/users/:userId/messages        — paginated chat_messages
 *   GET   /adminmax/users/:userId/usage.csv       — CSV export per user
 *   GET   /adminmax/usage.csv                     — global CSV export
 *
 * Filters
 * -------
 *  ?from=ISO8601 &to=ISO8601    inclusive lower / exclusive upper bound on
 *                                created_at. Defaults: last 30 days, now.
 *  ?limit=int    &offset=int     paginated endpoints (default 50, max 500).
 *
 * The handlers are intentionally read-only — there is no write surface here.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { query } from "../lib/db";
import {
    requireAdminMaxAuth,
    signAdminMaxToken,
} from "../middleware/adminMaxAuth";

export const adminMaxRouter = Router();

// ── helpers ───────────────────────────────────────────────────────────────

function parseDateRange(req: Request): { from: Date; to: Date } {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fromStr = typeof req.query.from === "string" ? req.query.from : "";
    const toStr = typeof req.query.to === "string" ? req.query.to : "";
    const from = fromStr ? new Date(fromStr) : defaultFrom;
    const to = toStr ? new Date(toStr) : now;
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return { from: defaultFrom, to: now };
    }
    return { from, to };
}

function parsePagination(req: Request): { limit: number; offset: number } {
    const rawLimit = parseInt(String(req.query.limit ?? ""), 10);
    const rawOffset = parseInt(String(req.query.offset ?? ""), 10);
    const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), 500)
        : 50;
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
    return { limit, offset };
}

// CSV escape per RFC 4180 — quote everything that contains comma, quote,
// or newline; double-up internal quotes.
function csvCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    const s = typeof value === "string" ? value : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function csvRow(cells: unknown[]): string {
    return cells.map(csvCell).join(",");
}

function isUuid(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        s,
    );
}

// ── login ─────────────────────────────────────────────────────────────────

// In-memory throttle to defang brute force. 10 failed attempts / IP / 5 min
// triggers a hard 429 until the window rolls over. Cloud Run scales out so
// this is per-instance — good enough at the volume we expect (manual ops).
const FAIL_WINDOW_MS = 5 * 60 * 1000;
const FAIL_LIMIT = 10;
const failureLog = new Map<string, number[]>();

function noteFailure(ip: string): number {
    const now = Date.now();
    const list = (failureLog.get(ip) ?? []).filter(
        (t) => t > now - FAIL_WINDOW_MS,
    );
    list.push(now);
    failureLog.set(ip, list);
    return list.length;
}

function tooManyFailures(ip: string): boolean {
    const now = Date.now();
    const list = (failureLog.get(ip) ?? []).filter(
        (t) => t > now - FAIL_WINDOW_MS,
    );
    failureLog.set(ip, list);
    return list.length >= FAIL_LIMIT;
}

adminMaxRouter.post("/login", (req: Request, res: Response) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";

    if (tooManyFailures(ip)) {
        res.status(429).json({ detail: "Too many failed attempts" });
        return;
    }

    const expected = process.env.ADMIN_MAX_PASSWORD;
    if (!expected) {
        console.error("[adminmax] ADMIN_MAX_PASSWORD not configured");
        res.status(500).json({ detail: "Admin auth not configured" });
        return;
    }
    const provided =
        typeof req.body?.password === "string" ? req.body.password : "";
    if (!provided) {
        noteFailure(ip);
        res.status(400).json({ detail: "Missing password" });
        return;
    }

    // Constant-time comparison so we don't leak password length / prefix
    // through response timing. Buffers must be equal length for
    // timingSafeEqual to run; pad both to the longer of the two.
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    const len = Math.max(expectedBuf.length, providedBuf.length);
    const a = Buffer.alloc(len);
    const b = Buffer.alloc(len);
    expectedBuf.copy(a);
    providedBuf.copy(b);
    const sameLength = expectedBuf.length === providedBuf.length;
    const ok = timingSafeEqual(a, b) && sameLength;

    if (!ok) {
        const count = noteFailure(ip);
        console.warn(
            `[adminmax] failed login from ${ip} (count=${count} in 5min window)`,
        );
        res.status(401).json({ detail: "Invalid password" });
        return;
    }

    try {
        const { token, expiresAt } = signAdminMaxToken();
        res.json({ token, expiresAt });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[adminmax] token signing failed:", msg);
        res.status(500).json({ detail: "Token signing failed" });
    }
});

// ── authenticated routes ──────────────────────────────────────────────────

adminMaxRouter.use(requireAdminMaxAuth);

/**
 * GET /adminmax/users
 *
 * Returns one row per user (left-joined to llm_usage so users with zero
 * activity in the window still appear with NULL totals). Sorted by
 * total_cost desc — the natural "who is burning money" view.
 */
adminMaxRouter.get("/users", async (req: Request, res: Response) => {
    const { from, to } = parseDateRange(req);
    try {
        const result = await query<{
            id: string;
            email: string;
            display_name: string | null;
            wp_user_id: number | null;
            iterations_total: string | null;
            input_tokens_total: string | null;
            output_tokens_total: string | null;
            cache_creation_input_tokens_total: string | null;
            cache_read_input_tokens_total: string | null;
            cost_usd_total: string | null;
            request_count: string;
            error_count: string;
            last_used: string | null;
        }>(
            `
            SELECT
                u.id, u.email, u.display_name, u.wp_user_id,
                COALESCE(SUM(lu.iterations), 0)                      AS iterations_total,
                COALESCE(SUM(lu.input_tokens), 0)                    AS input_tokens_total,
                COALESCE(SUM(lu.output_tokens), 0)                   AS output_tokens_total,
                COALESCE(SUM(lu.cache_creation_input_tokens), 0)     AS cache_creation_input_tokens_total,
                COALESCE(SUM(lu.cache_read_input_tokens), 0)         AS cache_read_input_tokens_total,
                COALESCE(SUM(lu.cost_usd), 0)                        AS cost_usd_total,
                COUNT(lu.id)                                         AS request_count,
                COUNT(lu.id) FILTER (WHERE lu.status = 'error')      AS error_count,
                MAX(lu.created_at)                                   AS last_used
            FROM public.users u
            LEFT JOIN public.llm_usage lu
                   ON lu.user_id = u.id
                  AND lu.created_at >= $1
                  AND lu.created_at <  $2
            GROUP BY u.id, u.email, u.display_name, u.wp_user_id
            ORDER BY cost_usd_total DESC NULLS LAST, u.email ASC
            `,
            [from.toISOString(), to.toISOString()],
        );

        res.json({
            range: { from: from.toISOString(), to: to.toISOString() },
            users: result.rows.map((r) => ({
                id: r.id,
                email: r.email,
                display_name: r.display_name,
                wp_user_id: r.wp_user_id,
                iterations_total: Number(r.iterations_total ?? 0),
                input_tokens_total: Number(r.input_tokens_total ?? 0),
                output_tokens_total: Number(r.output_tokens_total ?? 0),
                cache_creation_input_tokens_total: Number(
                    r.cache_creation_input_tokens_total ?? 0,
                ),
                cache_read_input_tokens_total: Number(
                    r.cache_read_input_tokens_total ?? 0,
                ),
                cost_usd_total: Number(r.cost_usd_total ?? 0),
                request_count: Number(r.request_count ?? 0),
                error_count: Number(r.error_count ?? 0),
                last_used: r.last_used,
            })),
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[adminmax/users] failed:", msg);
        res.status(500).json({ detail: "Failed to load users" });
    }
});

/**
 * GET /adminmax/users/:userId
 * Per-user totals + identity. 404 if user does not exist.
 */
adminMaxRouter.get(
    "/users/:userId",
    async (req: Request, res: Response) => {
        const { userId } = req.params;
        if (!isUuid(userId)) {
            res.status(400).json({ detail: "Invalid user id" });
            return;
        }
        const { from, to } = parseDateRange(req);
        try {
            const userRow = await query<{
                id: string;
                email: string;
                display_name: string | null;
                wp_user_id: number | null;
                created_at: string | null;
            }>(
                `SELECT id, email, display_name, wp_user_id, created_at
                   FROM public.users WHERE id = $1`,
                [userId],
            );
            if (userRow.rows.length === 0) {
                res.status(404).json({ detail: "User not found" });
                return;
            }
            const totals = await query<{
                iterations_total: string | null;
                input_tokens_total: string | null;
                output_tokens_total: string | null;
                cache_creation_input_tokens_total: string | null;
                cache_read_input_tokens_total: string | null;
                cost_usd_total: string | null;
                request_count: string;
                error_count: string;
                first_used: string | null;
                last_used: string | null;
            }>(
                `
                SELECT
                    COALESCE(SUM(iterations), 0)                  AS iterations_total,
                    COALESCE(SUM(input_tokens), 0)                AS input_tokens_total,
                    COALESCE(SUM(output_tokens), 0)               AS output_tokens_total,
                    COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens_total,
                    COALESCE(SUM(cache_read_input_tokens), 0)     AS cache_read_input_tokens_total,
                    COALESCE(SUM(cost_usd), 0)                    AS cost_usd_total,
                    COUNT(*)                                      AS request_count,
                    COUNT(*) FILTER (WHERE status = 'error')      AS error_count,
                    MIN(created_at)                               AS first_used,
                    MAX(created_at)                               AS last_used
                FROM public.llm_usage
                WHERE user_id = $1
                  AND created_at >= $2
                  AND created_at <  $3
                `,
                [userId, from.toISOString(), to.toISOString()],
            );
            const t = totals.rows[0];
            res.json({
                user: userRow.rows[0],
                range: { from: from.toISOString(), to: to.toISOString() },
                totals: {
                    iterations_total: Number(t.iterations_total ?? 0),
                    input_tokens_total: Number(t.input_tokens_total ?? 0),
                    output_tokens_total: Number(t.output_tokens_total ?? 0),
                    cache_creation_input_tokens_total: Number(
                        t.cache_creation_input_tokens_total ?? 0,
                    ),
                    cache_read_input_tokens_total: Number(
                        t.cache_read_input_tokens_total ?? 0,
                    ),
                    cost_usd_total: Number(t.cost_usd_total ?? 0),
                    request_count: Number(t.request_count ?? 0),
                    error_count: Number(t.error_count ?? 0),
                    first_used: t.first_used,
                    last_used: t.last_used,
                },
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[adminmax/users/:userId] failed:", msg);
            res.status(500).json({ detail: "Failed to load user" });
        }
    },
);

/**
 * GET /adminmax/users/:userId/usage
 * Paginated llm_usage rows for the user, newest first.
 */
adminMaxRouter.get(
    "/users/:userId/usage",
    async (req: Request, res: Response) => {
        const { userId } = req.params;
        if (!isUuid(userId)) {
            res.status(400).json({ detail: "Invalid user id" });
            return;
        }
        const { from, to } = parseDateRange(req);
        const { limit, offset } = parsePagination(req);
        try {
            const result = await query(
                `
                SELECT id, provider, model, chat_id, project_id,
                       chat_message_id, project_chat_message_id,
                       iterations,
                       input_tokens, output_tokens,
                       cache_creation_input_tokens, cache_read_input_tokens,
                       cost_usd, duration_ms, status, error_message,
                       created_at
                  FROM public.llm_usage
                 WHERE user_id = $1
                   AND created_at >= $2
                   AND created_at <  $3
              ORDER BY created_at DESC
                 LIMIT $4 OFFSET $5
                `,
                [
                    userId,
                    from.toISOString(),
                    to.toISOString(),
                    limit,
                    offset,
                ],
            );
            const total = await query<{ count: string }>(
                `SELECT COUNT(*)::text AS count
                   FROM public.llm_usage
                  WHERE user_id = $1
                    AND created_at >= $2
                    AND created_at <  $3`,
                [userId, from.toISOString(), to.toISOString()],
            );
            res.json({
                range: { from: from.toISOString(), to: to.toISOString() },
                limit,
                offset,
                total: Number(total.rows[0]?.count ?? 0),
                rows: result.rows,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[adminmax/users/:userId/usage] failed:", msg);
            res.status(500).json({ detail: "Failed to load usage" });
        }
    },
);

/**
 * GET /adminmax/users/:userId/messages
 *
 * Paginated chat messages for the user (newest first), joined to
 * the parent chat row so the UI can render context (chat title,
 * project membership). Both regular chats (chats.user_id = uuid::text)
 * and project chats are included — project chats are still rooted in
 * `chats` with project_id set.
 */
adminMaxRouter.get(
    "/users/:userId/messages",
    async (req: Request, res: Response) => {
        const { userId } = req.params;
        if (!isUuid(userId)) {
            res.status(400).json({ detail: "Invalid user id" });
            return;
        }
        const { from, to } = parseDateRange(req);
        const { limit, offset } = parsePagination(req);
        try {
            // chats.user_id is TEXT (legacy column type) — cast both sides
            // for a stable equality regardless of how the row was written.
            const result = await query(
                `
                SELECT cm.id, cm.role, cm.content, cm.files,
                       cm.annotations, cm.is_flagged, cm.created_at,
                       c.id      AS chat_id,
                       c.title   AS chat_title,
                       c.project_id
                  FROM public.chat_messages cm
                  JOIN public.chats c ON c.id = cm.chat_id
                 WHERE c.user_id::text = $1::text
                   AND cm.created_at >= $2
                   AND cm.created_at <  $3
              ORDER BY cm.created_at DESC
                 LIMIT $4 OFFSET $5
                `,
                [
                    userId,
                    from.toISOString(),
                    to.toISOString(),
                    limit,
                    offset,
                ],
            );
            const total = await query<{ count: string }>(
                `SELECT COUNT(*)::text AS count
                   FROM public.chat_messages cm
                   JOIN public.chats c ON c.id = cm.chat_id
                  WHERE c.user_id::text = $1::text
                    AND cm.created_at >= $2
                    AND cm.created_at <  $3`,
                [userId, from.toISOString(), to.toISOString()],
            );
            res.json({
                range: { from: from.toISOString(), to: to.toISOString() },
                limit,
                offset,
                total: Number(total.rows[0]?.count ?? 0),
                rows: result.rows,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[adminmax/users/:userId/messages] failed:", msg);
            res.status(500).json({ detail: "Failed to load messages" });
        }
    },
);

/**
 * GET /adminmax/users/:userId/usage.csv
 * Streams per-row usage as CSV. Honors the same ?from/?to filters.
 */
adminMaxRouter.get(
    "/users/:userId/usage.csv",
    async (req: Request, res: Response) => {
        const { userId } = req.params;
        if (!isUuid(userId)) {
            res.status(400).json({ detail: "Invalid user id" });
            return;
        }
        const { from, to } = parseDateRange(req);
        try {
            const result = await query(
                `
                SELECT id, created_at, provider, model,
                       chat_id, project_id,
                       iterations,
                       input_tokens, output_tokens,
                       cache_creation_input_tokens, cache_read_input_tokens,
                       cost_usd, duration_ms, status, error_message
                  FROM public.llm_usage
                 WHERE user_id = $1
                   AND created_at >= $2
                   AND created_at <  $3
              ORDER BY created_at ASC
                `,
                [userId, from.toISOString(), to.toISOString()],
            );
            const fileFromIso = from.toISOString().slice(0, 10);
            const fileToIso = to.toISOString().slice(0, 10);
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="adminmax_usage_${userId}_${fileFromIso}_${fileToIso}.csv"`,
            );
            res.write(
                csvRow([
                    "id",
                    "created_at",
                    "provider",
                    "model",
                    "chat_id",
                    "project_id",
                    "iterations",
                    "input_tokens",
                    "output_tokens",
                    "cache_creation_input_tokens",
                    "cache_read_input_tokens",
                    "cost_usd",
                    "duration_ms",
                    "status",
                    "error_message",
                ]) + "\n",
            );
            for (const row of result.rows) {
                res.write(
                    csvRow([
                        row.id,
                        row.created_at,
                        row.provider,
                        row.model,
                        row.chat_id,
                        row.project_id,
                        row.iterations,
                        row.input_tokens,
                        row.output_tokens,
                        row.cache_creation_input_tokens,
                        row.cache_read_input_tokens,
                        row.cost_usd,
                        row.duration_ms,
                        row.status,
                        row.error_message,
                    ]) + "\n",
                );
            }
            res.end();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[adminmax/users/:userId/usage.csv] failed:", msg);
            res.status(500).json({ detail: "Failed to export usage CSV" });
        }
    },
);

/**
 * GET /adminmax/usage.csv
 * Global CSV — every row across every user. Useful for offline reporting.
 */
adminMaxRouter.get("/usage.csv", async (req: Request, res: Response) => {
    const { from, to } = parseDateRange(req);
    try {
        const result = await query(
            `
            SELECT lu.id, lu.created_at, u.email, lu.user_id,
                   lu.provider, lu.model,
                   lu.chat_id, lu.project_id,
                   lu.iterations,
                   lu.input_tokens, lu.output_tokens,
                   lu.cache_creation_input_tokens, lu.cache_read_input_tokens,
                   lu.cost_usd, lu.duration_ms, lu.status, lu.error_message
              FROM public.llm_usage lu
              LEFT JOIN public.users u ON u.id = lu.user_id
             WHERE lu.created_at >= $1
               AND lu.created_at <  $2
          ORDER BY lu.created_at ASC
            `,
            [from.toISOString(), to.toISOString()],
        );
        const fileFromIso = from.toISOString().slice(0, 10);
        const fileToIso = to.toISOString().slice(0, 10);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="adminmax_usage_all_${fileFromIso}_${fileToIso}.csv"`,
        );
        res.write(
            csvRow([
                "id",
                "created_at",
                "user_email",
                "user_id",
                "provider",
                "model",
                "chat_id",
                "project_id",
                "iterations",
                "input_tokens",
                "output_tokens",
                "cache_creation_input_tokens",
                "cache_read_input_tokens",
                "cost_usd",
                "duration_ms",
                "status",
                "error_message",
            ]) + "\n",
        );
        for (const row of result.rows) {
            res.write(
                csvRow([
                    row.id,
                    row.created_at,
                    row.email,
                    row.user_id,
                    row.provider,
                    row.model,
                    row.chat_id,
                    row.project_id,
                    row.iterations,
                    row.input_tokens,
                    row.output_tokens,
                    row.cache_creation_input_tokens,
                    row.cache_read_input_tokens,
                    row.cost_usd,
                    row.duration_ms,
                    row.status,
                    row.error_message,
                ]) + "\n",
            );
        }
        res.end();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[adminmax/usage.csv] failed:", msg);
        res.status(500).json({ detail: "Failed to export global CSV" });
    }
});
