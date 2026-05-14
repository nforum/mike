import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";
import type {
    StreamChatParams,
    StreamChatResult,
    LlmUsage,
    NormalizedToolCall,
    NormalizedToolResult,
} from "./types";
import { toClaudeTools } from "./tools";

const DEBUG_LLM_STREAM = process.env.DEBUG_LLM_STREAM === "true";

type ContentBlock =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: string; [key: string]: unknown };

type NativeMessage = {
    role: "user" | "assistant";
    content: string | ContentBlock[];
};

// Per-API-call output ceiling. We hit the previous 16384 limit on a real
// 9-min, 27k-character turn (chat a1da7265…, 2026-05-13 16:30 UTC) where
// Claude exhausted the budget mid-answer and self-stopped with
// stop_reason="max_tokens" — the user saw it as a truncated reply.
//
// Sonnet 4.6 supports up to 64_000 output tokens per call (May 2026 API
// docs). Pricing is on consumed, not allowed, tokens, so raising the
// ceiling has no effective cost when the model would have stopped
// earlier anyway. Worst-case full-budget turn is ~64_000 × $15/1M
// ≈ $0.96 — acceptable for the rare long legal-research dump that
// previously broke.
const MAX_TOKENS = 64_000;

// Anthropic native server-side web search tool. Server-tool means Claude
// runs the search inside its inference and returns a `web_search_tool_result`
// content block in the same response — we do NOT see a tool_use callback
// for it, and we are billed $10 per 1k searches on top of token cost
// (≈ $0.05 per turn at max_uses=5). Must be enabled per-org in the
// Anthropic Console before the API will accept it.
//
// The `name` here is intentionally `web_search_native` to avoid colliding
// with our own multi-provider `web_search` custom tool (see WEB_SEARCH_TOOLS
// in chatTools.ts). Anthropic rejects requests with two tools sharing the
// same name. The description tweak below nudges Claude to prefer the
// custom tool when both are present, since it offers richer controls
// (recency_days, source_keys, provider routing).
const NATIVE_WEB_SEARCH_TOOL = {
    type: "web_search_20250305",
    name: "web_search_native",
    max_uses: 5,
    description:
        "Anthropic-hosted web search. Use only when no custom `web_search` tool is available, or when the user asks for a quick general fact-check. Prefer the custom `web_search` tool when present — it supports provider choice, recency filters, and curated source allowlists for legal/regulatory queries.",
} as const;

function shouldAttachNativeWebSearch(
    flag: boolean | undefined,
    model: string,
): boolean {
    const explicit = flag ?? null;
    if (explicit !== null) return explicit;
    if (process.env.CLAUDE_NATIVE_WEB_SEARCH === "true") return true;
    void model;
    return false;
}

function client(override?: string | null): Anthropic {
    const apiKey = override?.trim() || process.env.ANTHROPIC_API_KEY || "";
    // SDK defaults to maxRetries = 2 with exponential backoff, which is
    // not enough for the transient `UND_ERR_SOCKET: other side closed`
    // failures we see on Cloud Run mid-stream (revision swaps, idle
    // socket resets — see https://github.com/anthropics/claude-code/issues/37930).
    // Bumped to 5 + a generous per-request timeout (10 min) so the SDK
    // re-establishes the stream before the user-visible "load failed".
    return new Anthropic({
        apiKey,
        maxRetries: 5,
        timeout: 600_000,
    });
}

function toNativeMessages(
    messages: StreamChatParams["messages"],
): NativeMessage[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
}

export async function streamClaude(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const {
        model,
        systemPrompt,
        tools = [],
        callbacks = {},
        runTools,
        apiKeys,
        enableThinking,
        enableWebSearch,
        reasoningEffort,
    } = params;
    const effort: "low" | "medium" | "high" = reasoningEffort ?? "high";
    const maxIter = params.maxIterations ?? 10;
    const anthropic = client(apiKeys?.claude);
    const claudeTools = toClaudeTools(tools);

    // Optionally append Anthropic's native web search tool. Kept separate
    // from `claudeTools` (which is OpenAI-shape converted via toClaudeTools)
    // because the native tool uses a server-tool shape (`type: "web_search_…"`)
    // that does not flow through our normalizer.
    const attachNativeSearch = shouldAttachNativeWebSearch(enableWebSearch, model);
    const allTools: unknown[] = attachNativeSearch
        ? [...claudeTools, NATIVE_WEB_SEARCH_TOOL]
        : claudeTools;
    if (attachNativeSearch && DEBUG_LLM_STREAM) {
        console.debug(
            "[claude] native web_search tool attached (name=web_search_native, max_uses=5)",
        );
    }

    const messages: NativeMessage[] = toNativeMessages(params.messages);
    let fullText = "";
    // Accumulate token usage across every Anthropic API call we make
    // inside this turn. One user turn can trigger several calls (one
    // per tool-use iteration), each with its own usage block; we sum
    // them so the caller logs/persists a single number per turn.
    const usage: LlmUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        iterations: 0,
    };

    for (let iter = 0; iter < maxIter; iter++) {
        const stream = anthropic.messages.stream({
            model,
            system: systemPrompt,
            messages: messages as Anthropic.MessageParam[],
            tools: allTools.length
                ? (allTools as unknown as Tool[])
                : undefined,
            max_tokens: MAX_TOKENS,
            // Claude 4.x models require `thinking.type: "adaptive"` and
            // drive effort via `output_config.effort` rather than a fixed
            // token budget. We only opt in when the caller requested it.
            ...(enableThinking
                ? ({
                      thinking: { type: "adaptive" },
                      output_config: { effort },
                  } as unknown as Record<string, unknown>)
                : {}),
            // Extended thinking requires temperature to be default (omitted).
        });

        let sawThinking = false;

        stream.on("streamEvent", (event) => {
            if (DEBUG_LLM_STREAM) {
                console.debug("[claude raw stream]", JSON.stringify(event));
            }
        });

        stream.on("text", (delta) => {
            callbacks.onContentDelta?.(delta);
        });
        if (enableThinking) {
            stream.on("thinking", (delta) => {
                sawThinking = true;
                callbacks.onReasoningDelta?.(delta);
            });
        }

        const final = await stream.finalMessage();
        if (sawThinking) callbacks.onReasoningBlockEnd?.();
        const stopReason = final.stop_reason;
        const assistantBlocks = final.content as ContentBlock[];

        // Surface "I ran out of room" stops to the log so we can spot
        // truncated answers in cost forensics. The user sees it as a
        // mid-sentence cutoff but the platform logs nothing — without
        // this line we cannot tell why a turn ended short.
        if (stopReason === "max_tokens") {
            console.warn(
                `[claude] hit max_tokens ceiling (iter=${iter}, MAX_TOKENS=${MAX_TOKENS}). ` +
                    `Output may be truncated. Consider raising MAX_TOKENS or asking the user for a continuation.`,
            );
        }

        // Accumulate per-call usage. Anthropic guarantees this on every
        // non-error response; missing fields default to 0 (e.g. prompt
        // caching off).
        const u = final.usage as
            | {
                  input_tokens?: number;
                  output_tokens?: number;
                  cache_creation_input_tokens?: number;
                  cache_read_input_tokens?: number;
              }
            | undefined;
        if (u) {
            usage.iterations += 1;
            usage.inputTokens += u.input_tokens ?? 0;
            usage.outputTokens += u.output_tokens ?? 0;
            usage.cacheCreationInputTokens += u.cache_creation_input_tokens ?? 0;
            usage.cacheReadInputTokens += u.cache_read_input_tokens ?? 0;
        }

        // Extract text content and tool_use calls from the final assistant
        // message so we can accumulate text and drive the tool-call loop.
        const toolCalls: NormalizedToolCall[] = [];
        for (const block of assistantBlocks) {
            if (block.type === "text") {
                const txt = (block as { text: string }).text;
                if (typeof txt === "string") fullText += txt;
            } else if (block.type === "tool_use") {
                const tu = block as {
                    id: string;
                    name: string;
                    input: unknown;
                };
                const call: NormalizedToolCall = {
                    id: tu.id,
                    name: tu.name,
                    input: (tu.input as Record<string, unknown>) ?? {},
                };
                callbacks.onToolCallStart?.(call);
                toolCalls.push(call);
            }
        }

        if (stopReason !== "tool_use" || !toolCalls.length || !runTools) {
            break;
        }

        const results = await runTools(toolCalls);

        // Record the assistant turn (preserving the original content blocks,
        // which Claude requires on the follow-up) and the user turn that
        // carries the tool_result blocks.
        messages.push({ role: "assistant", content: assistantBlocks });
        messages.push({
            role: "user",
            content: results.map((r) => ({
                type: "tool_result",
                tool_use_id: r.tool_use_id,
                content: r.content,
            })),
        });
    }

    return { fullText, usage: usage.iterations > 0 ? usage : undefined };
}

export async function completeClaudeText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: { claude?: string | null };
}): Promise<string> {
    const anthropic = client(params.apiKeys?.claude);
    const resp = await anthropic.messages.create({
        model: params.model,
        max_tokens: params.maxTokens ?? 512,
        system: params.systemPrompt,
        messages: [{ role: "user", content: params.user }],
    });
    const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    return text;
}

// Helper re-export for callers wanting to hand normalized results back in.
export type { NormalizedToolResult };
