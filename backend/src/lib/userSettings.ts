import { createServerSupabase } from "./supabase";
import {
    resolveModel,
    DEFAULT_TITLE_MODEL,
    DEFAULT_TABULAR_MODEL,
    type UserApiKeys,
} from "./llm";
import { decryptApiKey } from "./crypto";

export type UserModelSettings = {
    title_model: string;
    tabular_model: string;
    api_keys: UserApiKeys;
};

// Title generation is a lightweight task — always routed to the cheapest model
// of whichever provider the user has keys for: LocalLLM lite if available, 
// otherwise Gemini Flash Lite, otherwise Claude Haiku.
function resolveTitleModel(apiKeys: UserApiKeys): string {
    // Check if LocalLLM is configured server-side
    if (process.env.VLLM_BASE_URL?.trim()) {
        return "localllm-lite";
    }
    if (apiKeys.gemini?.trim()) return DEFAULT_TITLE_MODEL;
    if (apiKeys.claude?.trim()) return "claude-haiku-4-5";
    if (apiKeys.openai?.trim()) return "gpt-5.4-nano";
    if (apiKeys.mistral?.trim() || process.env.MISTRAL_API_KEY?.trim()) return "mistral-small-latest";
    return DEFAULT_TITLE_MODEL;
}

/** Try to decrypt; if the value isn't encrypted just return as-is. */
function safeDecrypt(val: string | null | undefined): string | null {
    if (!val?.trim()) return null;
    try {
        return decryptApiKey(val);
    } catch {
        // Might be a plaintext key from before encryption was added
        return val;
    }
}

export async function getUserModelSettings(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserModelSettings> {
    const client = db ?? createServerSupabase();
    const { data } = await client
        .from("user_profiles")
        .select("tabular_model, claude_api_key, gemini_api_key, openai_api_key, mistral_api_key")
        .eq("user_id", userId)
        .single();

    const api_keys: UserApiKeys = {
        claude: safeDecrypt(data?.claude_api_key),
        gemini: safeDecrypt(data?.gemini_api_key),
        openai: safeDecrypt(data?.openai_api_key) ?? process.env.VLLM_API_KEY ?? null,
        mistral: safeDecrypt(data?.mistral_api_key),
    };

    return {
        title_model: resolveTitleModel(api_keys),
        tabular_model: resolveModel(data?.tabular_model, "localllm-main"),
        api_keys,
    };
}

export async function getUserApiKeys(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserApiKeys> {
    const client = db ?? createServerSupabase();
    const { data } = await client
        .from("user_profiles")
        .select("claude_api_key, gemini_api_key, openai_api_key, mistral_api_key")
        .eq("user_id", userId)
        .single();
    return {
        claude: safeDecrypt(data?.claude_api_key),
        gemini: safeDecrypt(data?.gemini_api_key),
        openai: safeDecrypt(data?.openai_api_key) ?? process.env.VLLM_API_KEY ?? null,
        mistral: safeDecrypt(data?.mistral_api_key),
    };
}
