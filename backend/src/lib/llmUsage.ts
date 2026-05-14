/**
 * Per-turn LLM cost tracking.
 *
 * Anthropic returns authoritative token counts on every API response.
 * The provider does NOT return a USD figure on the wire — we compute
 * it here from the published per-million-token rates so the numbers
 * match what shows up on the Anthropic console invoice.
 *
 * Pricing references (verified via TokenMix.ai / pecollective.com /
 * pricepertoken.com / Anthropic docs, May 2026):
 *
 *   Claude Sonnet 4.6 (claude-sonnet-4-6):
 *     input                   $3.00  / 1M tokens
 *     output                  $15.00 / 1M tokens
 *     cache write (5 min)     $3.75  / 1M tokens   (1.25× input)
 *     cache read              $0.30  / 1M tokens   (0.10× input, "90% off")
 *
 * Add new model entries here when we expose them in product. Unknown
 * model ids fall back to no cost rather than guessing — the row still
 * gets the raw token counts so we can backfill USD later.
 */
import type { LlmUsage } from "./llm/types";
import { query } from "./db";

type Rate = {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
};

const M = 1_000_000;

const PRICING: Record<string, Rate> = {
    // Standard API rates for Claude Sonnet 4.6 as of May 2026.
    "claude-sonnet-4-6": {
        input: 3.0 / M,
        output: 15.0 / M,
        cacheWrite: 3.75 / M,
        cacheRead: 0.3 / M,
    },
};

/**
 * Compute USD cost for a usage block. Returns 0 (rather than throwing)
 * when the model is unpriced — that way unknown models still get a row
 * with token counts and we can revisit pricing later.
 */
export function computeCostUsd(model: string, usage: LlmUsage): number {
    const rate = PRICING[model];
    if (!rate) return 0;
    const cost =
        usage.inputTokens * rate.input +
        usage.outputTokens * rate.output +
        usage.cacheCreationInputTokens * rate.cacheWrite +
        usage.cacheReadInputTokens * rate.cacheRead;
    // Round to 6 decimals to fit numeric(12, 6). The smallest meaningful
    // unit is 1 cache-read token = $3 × 10⁻⁷, which still rounds cleanly.
    return Math.round(cost * 1e6) / 1e6;
}

export type RecordUsageInput = {
    userId: string;
    provider: "claude" | "openai" | "gemini" | "mistral" | string;
    model: string;
    chatId?: string | null;
    projectId?: string | null;
    chatMessageId?: string | null;
    projectChatMessageId?: string | null;
    usage: LlmUsage;
    durationMs?: number | null;
    status?: "ok" | "error" | "aborted";
    errorMessage?: string | null;
};

/**
 * Persist one usage row and emit a structured log line. Failures are
 * swallowed (logged at WARN) — a failed insert must never tear down a
 * successful chat response. This is observability, not core flow.
 */
export async function recordLlmUsage(input: RecordUsageInput): Promise<void> {
    const {
        userId,
        provider,
        model,
        chatId = null,
        projectId = null,
        chatMessageId = null,
        projectChatMessageId = null,
        usage,
        durationMs = null,
        status = "ok",
        errorMessage = null,
    } = input;

    const costUsd = computeCostUsd(model, usage);

    // Single structured line — easy to grep "[llm/usage]" in Cloud
    // Logging and dump it through `gcloud logging read` for ad-hoc
    // cost reports while we don't yet have a UI.
    console.log(
        `[llm/usage] user=${userId} model=${model} provider=${provider} ` +
            `iters=${usage.iterations} ` +
            `in=${usage.inputTokens} out=${usage.outputTokens} ` +
            `cache_w=${usage.cacheCreationInputTokens} cache_r=${usage.cacheReadInputTokens} ` +
            `cost_usd=${costUsd.toFixed(6)} ` +
            `chat=${chatId ?? "-"} project=${projectId ?? "-"} ` +
            `status=${status}` +
            (durationMs != null ? ` duration_ms=${durationMs}` : "") +
            (errorMessage ? ` error=${JSON.stringify(errorMessage)}` : ""),
    );

    try {
        await query(
            `
            INSERT INTO public.llm_usage (
                user_id, provider, model,
                chat_id, project_id,
                chat_message_id, project_chat_message_id,
                iterations,
                input_tokens, output_tokens,
                cache_creation_input_tokens, cache_read_input_tokens,
                cost_usd, duration_ms, status, error_message
            ) VALUES (
                $1, $2, $3,
                $4, $5,
                $6, $7,
                $8,
                $9, $10,
                $11, $12,
                $13, $14, $15, $16
            )
            `,
            [
                userId,
                provider,
                model,
                chatId,
                projectId,
                chatMessageId,
                projectChatMessageId,
                usage.iterations,
                usage.inputTokens,
                usage.outputTokens,
                usage.cacheCreationInputTokens,
                usage.cacheReadInputTokens,
                costUsd,
                durationMs,
                status,
                errorMessage,
            ],
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[llm/usage] insert failed (non-fatal): ${msg}`);
    }
}
