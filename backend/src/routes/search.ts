/**
 * Internal REST entrypoint for the multi-provider web search.
 *
 *   POST /search                    (auth required)
 *     Body:
 *       {
 *         query:           string                 (required)
 *         provider?:       "tavily" | "exa" | "parallel" | "you"
 *         num_results?:    number  (1-10)
 *         project_id?:     string  (resolves search_config.json defaults)
 *         source_keys?:    string[] (resolved against external_sources.json)
 *         include_domains?: string[]
 *         exclude_domains?: string[]
 *         recency_days?:   number
 *       }
 *     Returns: SearchResponse JSON (provider, query, results, optional answer/context).
 *
 * Used by Max clients (Word add-in "Find sources" panel, debug UI)
 * that want to search without going through the LLM toolcall flow.
 * The LLM toolcall path lives in chatTools.ts and shares the same
 * underlying webSearch() function — so config and behavior stay in
 * lock-step automatically.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { webSearch, type SearchProvider } from "../lib/search";
import { resolveProjectSearchConfig } from "../lib/search/search_config";

export const searchRouter = Router();

function isProvider(s: unknown): s is SearchProvider {
    return s === "tavily" || s === "exa" || s === "parallel" || s === "you";
}

function asStringArray(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out = v.filter((x): x is string => typeof x === "string");
    return out.length ? out : undefined;
}

searchRouter.post("/", requireAuth, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
        return res.status(400).json({ error: "query is required" });
    }
    if (query.length > 2000) {
        return res
            .status(400)
            .json({ error: "query must be ≤ 2000 characters" });
    }

    const projectId =
        typeof body.project_id === "string" ? body.project_id : null;
    const cfg = resolveProjectSearchConfig(projectId);

    const requestedProvider = isProvider(body.provider)
        ? body.provider
        : undefined;
    // Honor per-call override; fall back to project preferred; final
    // fallback to webSearch's auto-pick.
    const provider =
        requestedProvider ?? cfg.preferred_provider ?? undefined;

    const numResultsRaw =
        typeof body.num_results === "number"
            ? body.num_results
            : cfg.num_results;
    const num_results = Math.min(Math.max(numResultsRaw ?? 5, 1), 10);

    const recencyRaw =
        typeof body.recency_days === "number"
            ? body.recency_days
            : cfg.recency_days;
    const recency_days = recencyRaw ?? undefined;

    const include_domains = asStringArray(body.include_domains);
    const exclude_domains = asStringArray(body.exclude_domains);
    const source_keys = asStringArray(body.source_keys) ?? cfg.source_keys;

    const resp = await webSearch({
        query,
        provider,
        num_results,
        include_domains,
        exclude_domains,
        recency_days,
        source_keys: source_keys.length ? source_keys : undefined,
        allowed_providers: cfg.providers,
    });

    res.json(resp);
});
