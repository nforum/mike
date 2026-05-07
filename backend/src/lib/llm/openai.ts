import OpenAI from "openai";
import type {
    StreamChatParams,
    StreamChatResult,
    NormalizedToolCall,
    NormalizedToolResult,
} from "./types";

// ---------------------------------------------------------------------------
// Client factory — returns either an OpenAI-direct client or a vLLM-
// compatible client depending on the model being used.
// ---------------------------------------------------------------------------

function isLocalModel(model: string): boolean {
    return model.startsWith("localllm");
}

function openaiClient(override?: string | null): OpenAI {
    const apiKey = override?.trim() || process.env.OPENAI_API_KEY || "";
    return new OpenAI({ apiKey });
}

function vllmClient(override?: string | null): OpenAI {
    const apiKey = override?.trim() || process.env.VLLM_API_KEY || "";
    const baseURL = process.env.VLLM_BASE_URL || "http://localhost:8000/v1";
    console.log("[localllm] Client init:", { baseURL, apiKeyPresent: !!apiKey });
    return new OpenAI({ apiKey, baseURL });
}

function getClient(model: string, apiKeyOverride?: string | null): OpenAI {
    if (isLocalModel(model)) return vllmClient(apiKeyOverride);
    return openaiClient(apiKeyOverride);
}

function getActualModelName(model: string): string {
    if (model === "localllm-main") {
        return process.env.VLLM_MAIN_MODEL || "BredaAI";
    }
    if (model === "localllm-lite") {
        return process.env.VLLM_LIGHT_MODEL || "unsloth/gemma-4-E2B-it-GGUF:Q5_K_S";
    }
    return model;
}

// ---------------------------------------------------------------------------
// Tool conversion
// ---------------------------------------------------------------------------

function toOpenAITools(
    tools: StreamChatParams["tools"],
): OpenAI.ChatCompletionTool[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((t) => ({
        type: "function" as const,
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        },
    }));
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export async function streamOpenAI(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const {
        model,
        systemPrompt,
        tools = [],
        callbacks = {},
        runTools,
        apiKeys,
    } = params;
    const maxIter = params.maxIterations ?? 10;
    const actualModel = getActualModelName(model);
    const client = getClient(model, apiKeys?.openai);
    const openaiTools = toOpenAITools(tools);

    if (isLocalModel(model)) {
        console.log("[localllm] streaming request:", {
            internalModel: model,
            actualModel,
            baseURL: process.env.VLLM_BASE_URL,
        });
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...params.messages.map(
            (m): OpenAI.ChatCompletionMessageParam => ({
                role: m.role,
                content: m.content,
            }),
        ),
    ];

    let fullText = "";

    try {
        for (let iter = 0; iter < maxIter; iter++) {
            const stream = await client.chat.completions.create({
                model: actualModel,
                messages,
                tools: openaiTools,
                stream: true,
            });

            const textParts: string[] = [];
            const toolCalls: NormalizedToolCall[] = [];
            const toolCallAccumulators: Map<
                number,
                { id: string; name: string; args: string }
            > = new Map();

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                if (!delta) continue;

                if (delta.content) {
                    textParts.push(delta.content);
                    callbacks.onContentDelta?.(delta.content);
                }

                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const existing = toolCallAccumulators.get(tc.index);
                        if (existing) {
                            if (tc.function?.arguments)
                                existing.args += tc.function.arguments;
                        } else {
                            toolCallAccumulators.set(tc.index, {
                                id: tc.id ?? `tool-${tc.index}`,
                                name: tc.function?.name ?? "",
                                args: tc.function?.arguments ?? "",
                            });
                        }
                    }
                }
            }

            for (const [, acc] of toolCallAccumulators) {
                let input: Record<string, unknown> = {};
                try {
                    input = JSON.parse(acc.args);
                } catch {}
                const call: NormalizedToolCall = {
                    id: acc.id,
                    name: acc.name,
                    input,
                };
                callbacks.onToolCallStart?.(call);
                toolCalls.push(call);
            }

            fullText += textParts.join("");

            if (!toolCalls.length || !runTools) {
                break;
            }

            const results = await runTools(toolCalls);

            messages.push({
                role: "assistant",
                content: textParts.join("") || null,
                tool_calls: toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function" as const,
                    function: {
                        name: tc.name,
                        arguments: JSON.stringify(tc.input),
                    },
                })),
            });

            for (const r of results) {
                messages.push({
                    role: "tool",
                    tool_call_id: r.tool_use_id,
                    content: r.content,
                });
            }
        }
    } catch (error: any) {
        if (isLocalModel(model)) {
            console.error("[localllm] streaming error:", error.message);
            console.error("[localllm] error details:", JSON.stringify(error, null, 2));
        }
        throw error;
    }

    return { fullText };
}

export async function completeOpenAIText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: { openai?: string | null };
}): Promise<string> {
    const actualModel = getActualModelName(params.model);
    const client = getClient(params.model, params.apiKeys?.openai);
    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (params.systemPrompt) {
        messages.push({ role: "system", content: params.systemPrompt });
    }
    messages.push({ role: "user", content: params.user });
    const resp = await client.chat.completions.create({
        model: actualModel,
        messages,
        max_tokens: params.maxTokens ?? 512,
    });
    return resp.choices[0]?.message?.content ?? "";
}

export type { NormalizedToolResult };
