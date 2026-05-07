/**
 * OAuth 2.1 PKCE client for MikeOSS.
 *
 * Handles the Authorization Code + PKCE flow against the
 * eulex.ai WordPress OAuth server (eulex-mcp-oauth.php).
 *
 * Token storage: httpOnly cookies are ideal but require a
 * Next.js API route proxy. For this SPA-style client that
 * talks directly to a separate backend, we use localStorage
 * with short-lived access tokens (7 d) + refresh rotation.
 *
 * @module oauth
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OAUTH_ISSUER = "https://eulex.ai";
const AUTHORIZE_URL = `${OAUTH_ISSUER}/eulex-ai/mcp-oauth/authorize`;
const TOKEN_URL = `${OAUTH_ISSUER}/eulex-ai/mcp-oauth/token`;
const REVOKE_URL = `${OAUTH_ISSUER}/eulex-ai/mcp-oauth/revoke`;

const CLIENT_ID =
    process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID ?? "mike_default_client";
const REDIRECT_URI =
    process.env.NEXT_PUBLIC_OAUTH_REDIRECT_URI ??
    (typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback`
        : "http://localhost:3000/auth/callback");

const STORAGE_KEY = "mike_oauth_tokens";
const PKCE_VERIFIER_KEY = "mike_oauth_pkce_verifier";
const PKCE_STATE_KEY = "mike_oauth_pkce_state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenSet {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    /** Unix ms when access_token expires (computed on storage) */
    expires_at: number;
    scope: string;
    token_type: string;
}

export interface OAuthUser {
    /** WordPress user_id (from JWT sub) */
    id: string;
    email: string;
    name: string;
    tier: "free" | "plus";
    tier_level_id: number;
    scope: string;
}

// ---------------------------------------------------------------------------
// PKCE Helpers (RFC 7636)
// ---------------------------------------------------------------------------

/** Generate a cryptographic random code_verifier (43-128 chars). */
export function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64UrlEncode(array);
}

/** Derive SHA-256 code_challenge from a code_verifier. */
export async function generateCodeChallenge(
    verifier: string,
): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(buffer: Uint8Array): string {
    let binary = "";
    for (const byte of buffer) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a random state parameter for CSRF protection. */
export function generateState(): string {
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    return base64UrlEncode(array);
}

// ---------------------------------------------------------------------------
// Authorization Flow
// ---------------------------------------------------------------------------

/**
 * Build the full authorization URL and store PKCE verifier + state
 * in sessionStorage (survives redirect, cleared on tab close).
 */
export async function startAuthorizationFlow(
    scope = "mike:projects mike:documents mike:chat",
): Promise<string> {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = generateState();

    // Persist for the callback
    sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
    sessionStorage.setItem(PKCE_STATE_KEY, state);

    const params = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        scope,
    });

    return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens.
 * Called from the /auth/callback page.
 */
export async function exchangeCodeForTokens(
    code: string,
    state: string,
): Promise<TokenSet> {
    // Verify state matches
    const storedState = sessionStorage.getItem(PKCE_STATE_KEY);
    if (!storedState || storedState !== state) {
        throw new Error("State mismatch — possible CSRF attack");
    }

    const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
    if (!verifier) {
        throw new Error("Missing PKCE verifier — flow was interrupted");
    }

    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            grant_type: "authorization_code",
            code,
            code_verifier: verifier,
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
            error.error_description || error.error || `Token exchange failed (${response.status})`,
        );
    }

    const data = await response.json();

    // Clean up PKCE state
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(PKCE_STATE_KEY);

    const tokenSet: TokenSet = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        expires_at: Date.now() + data.expires_in * 1000,
        scope: data.scope,
        token_type: data.token_type,
    };

    storeTokens(tokenSet);
    return tokenSet;
}

/**
 * Refresh the access token using the stored refresh_token.
 * The WordPress plugin rotates refresh tokens on each use.
 */
export async function refreshAccessToken(): Promise<TokenSet | null> {
    const current = getStoredTokens();
    if (!current?.refresh_token) return null;

    try {
        const response = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                grant_type: "refresh_token",
                refresh_token: current.refresh_token,
                client_id: CLIENT_ID,
            }),
        });

        if (!response.ok) {
            // Refresh token expired or revoked — force re-login
            clearTokens();
            return null;
        }

        const data = await response.json();
        const tokenSet: TokenSet = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in,
            expires_at: Date.now() + data.expires_in * 1000,
            scope: data.scope,
            token_type: data.token_type,
        };

        storeTokens(tokenSet);
        return tokenSet;
    } catch {
        // Network error during refresh — don't clear tokens, let user retry
        return null;
    }
}

// ---------------------------------------------------------------------------
// Token Storage
// ---------------------------------------------------------------------------

export function getStoredTokens(): TokenSet | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as TokenSet;
    } catch {
        return null;
    }
}

export function storeTokens(tokens: TokenSet): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function clearTokens(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(PKCE_STATE_KEY);
}

// ---------------------------------------------------------------------------
// Token Introspection
// ---------------------------------------------------------------------------

/**
 * Check if the stored access token is expired (with 60s buffer).
 */
export function isAccessTokenExpired(): boolean {
    const tokens = getStoredTokens();
    if (!tokens) return true;
    // Add 60 second buffer before actual expiry
    return Date.now() >= tokens.expires_at - 60_000;
}

/**
 * Decode JWT payload WITHOUT verification (client-side user display only).
 * Actual verification happens on the backend.
 */
export function decodeJwtPayload(token: string): OAuthUser | null {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;

        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));

        return {
            id: payload.sub,
            email: payload.email,
            name: payload.name,
            tier: payload.tier,
            tier_level_id: payload.tier_level_id,
            scope: payload.scope,
        };
    } catch {
        return null;
    }
}

/**
 * Get a valid access token, refreshing if needed.
 * Returns null if no tokens available and refresh fails.
 */
export async function getValidAccessToken(): Promise<string | null> {
    const tokens = getStoredTokens();
    if (!tokens) return null;

    if (!isAccessTokenExpired()) {
        return tokens.access_token;
    }

    // Try refresh
    const refreshed = await refreshAccessToken();
    return refreshed?.access_token ?? null;
}

// ---------------------------------------------------------------------------
// Sign Out
// ---------------------------------------------------------------------------

/**
 * Revoke tokens on the server and clear local storage.
 */
export async function signOut(): Promise<void> {
    const tokens = getStoredTokens();

    if (tokens?.refresh_token) {
        // Best-effort revoke (don't block on failure)
        fetch(REVOKE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: tokens.refresh_token }),
        }).catch(() => {
            // Ignore network errors during sign-out
        });
    }

    clearTokens();
}
