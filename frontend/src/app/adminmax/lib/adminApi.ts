/**
 * AdminMax API client.
 *
 * Token storage is intentionally separate from the user OAuth track
 * (`tokens` in localStorage). The admin token never leaves localStorage
 * and is only sent on /adminmax/* fetches.
 */

const API_BASE =
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3001";

const TOKEN_KEY = "adminmax_token";
const TOKEN_EXPIRES_KEY = "adminmax_token_expires_at";

export function getAdminToken(): string | null {
    if (typeof window === "undefined") return null;
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const expiresRaw = window.localStorage.getItem(TOKEN_EXPIRES_KEY);
    const expires = expiresRaw ? parseInt(expiresRaw, 10) : 0;
    if (expires && expires < Date.now()) {
        clearAdminToken();
        return null;
    }
    return token;
}

export function setAdminToken(token: string, expiresAt: number): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(TOKEN_EXPIRES_KEY, String(expiresAt));
}

export function clearAdminToken(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(TOKEN_EXPIRES_KEY);
}

async function adminFetch<T>(
    path: string,
    init?: RequestInit,
): Promise<T> {
    const token = getAdminToken();
    if (!token) throw new AdminUnauthorizedError("No admin token");
    const res = await fetch(`${API_BASE}/adminmax${path}`, {
        cache: "no-store",
        ...init,
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            ...(init?.headers as Record<string, string> | undefined),
        },
    });
    if (res.status === 401) {
        clearAdminToken();
        throw new AdminUnauthorizedError("Admin token rejected");
    }
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Admin API error: ${res.status}`);
    }
    if (res.headers.get("content-type")?.includes("application/json")) {
        return (await res.json()) as T;
    }
    return undefined as T;
}

export class AdminUnauthorizedError extends Error {}

// ── login ────────────────────────────────────────────────────────────────

export async function adminLogin(password: string): Promise<{
    token: string;
    expiresAt: number;
}> {
    const res = await fetch(`${API_BASE}/adminmax/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
    });
    if (res.status === 429) {
        throw new Error("Previše neuspjelih pokušaja. Pričekajte 5 minuta.");
    }
    if (res.status === 401) {
        throw new Error("Pogrešna lozinka.");
    }
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Admin login failed: ${res.status}`);
    }
    const body = (await res.json()) as { token: string; expiresAt: number };
    setAdminToken(body.token, body.expiresAt);
    return body;
}

// ── domain types ─────────────────────────────────────────────────────────

export interface AdminUserSummary {
    id: string;
    email: string;
    display_name: string | null;
    wp_user_id: number | null;
    iterations_total: number;
    input_tokens_total: number;
    output_tokens_total: number;
    cache_creation_input_tokens_total: number;
    cache_read_input_tokens_total: number;
    cost_usd_total: number;
    request_count: number;
    error_count: number;
    last_used: string | null;
}

export interface AdminUsersResponse {
    range: { from: string; to: string };
    users: AdminUserSummary[];
}

export interface AdminUserDetailResponse {
    user: {
        id: string;
        email: string;
        display_name: string | null;
        wp_user_id: number | null;
        created_at: string | null;
    };
    range: { from: string; to: string };
    totals: {
        iterations_total: number;
        input_tokens_total: number;
        output_tokens_total: number;
        cache_creation_input_tokens_total: number;
        cache_read_input_tokens_total: number;
        cost_usd_total: number;
        request_count: number;
        error_count: number;
        first_used: string | null;
        last_used: string | null;
    };
}

export interface AdminUsageRow {
    id: string;
    provider: string;
    model: string;
    chat_id: string | null;
    project_id: string | null;
    chat_message_id: string | null;
    project_chat_message_id: string | null;
    iterations: number;
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    cost_usd: string | number;
    duration_ms: number | null;
    status: string;
    error_message: string | null;
    created_at: string;
}

export interface AdminMessageRow {
    id: string;
    role: "user" | "assistant" | string;
    content: unknown;
    files: unknown;
    annotations: unknown;
    is_flagged: boolean | null;
    created_at: string;
    chat_id: string;
    chat_title: string | null;
    project_id: string | null;
}

export interface PaginatedRows<T> {
    range: { from: string; to: string };
    limit: number;
    offset: number;
    total: number;
    rows: T[];
}

// ── data fetchers ────────────────────────────────────────────────────────

function rangeQuery(range?: { from?: string; to?: string }): string {
    const params = new URLSearchParams();
    if (range?.from) params.set("from", range.from);
    if (range?.to) params.set("to", range.to);
    const s = params.toString();
    return s ? `?${s}` : "";
}

export function listUsers(range?: {
    from?: string;
    to?: string;
}): Promise<AdminUsersResponse> {
    return adminFetch<AdminUsersResponse>(`/users${rangeQuery(range)}`);
}

export function getUser(
    userId: string,
    range?: { from?: string; to?: string },
): Promise<AdminUserDetailResponse> {
    return adminFetch<AdminUserDetailResponse>(
        `/users/${userId}${rangeQuery(range)}`,
    );
}

export function listUsage(
    userId: string,
    opts?: { from?: string; to?: string; limit?: number; offset?: number },
): Promise<PaginatedRows<AdminUsageRow>> {
    const params = new URLSearchParams();
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to) params.set("to", opts.to);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const q = params.toString();
    return adminFetch<PaginatedRows<AdminUsageRow>>(
        `/users/${userId}/usage${q ? `?${q}` : ""}`,
    );
}

export function listMessages(
    userId: string,
    opts?: { from?: string; to?: string; limit?: number; offset?: number },
): Promise<PaginatedRows<AdminMessageRow>> {
    const params = new URLSearchParams();
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to) params.set("to", opts.to);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const q = params.toString();
    return adminFetch<PaginatedRows<AdminMessageRow>>(
        `/users/${userId}/messages${q ? `?${q}` : ""}`,
    );
}

/**
 * Build a CSV download URL. We append `token=` so the browser-driven
 * GET (window.open) carries the admin token; the backend accepts either
 * Authorization header or `?token=` to stay friendly to <a download>.
 *
 * Note: backend currently only honors Authorization. For a click-driven
 * download we therefore fetch the CSV with auth, then trigger a blob
 * download in JS — see triggerCsvDownload below.
 */
export async function triggerCsvDownload(
    path: string,
    filename: string,
): Promise<void> {
    const token = getAdminToken();
    if (!token) throw new AdminUnauthorizedError("No admin token");
    const res = await fetch(`${API_BASE}/adminmax${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `CSV export failed: ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
