"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
    useCallback,
} from "react";
import { useAuth } from "@/contexts/AuthContext";

interface UserProfile {
    displayName: string | null;
    organisation: string | null;
    messageCreditsUsed: number;
    creditsResetDate: string;
    creditsRemaining: number;
    tier: string;
    tabularModel: string;
    /**
     * User's reasoning-intensity preference for the main composer
     * (Brain icon picker). Persisted in `user_profiles.reasoning_effort`
     * (migration 113) so it survives reloads, sign-outs, and switching
     * devices. Maps 1:1 to provider-native effort/level params.
     */
    reasoningEffort: "low" | "medium" | "high";
    claudeApiKey: string | null;
    geminiApiKey: string | null;
    openaiApiKey: string | null;
    mistralApiKey: string | null;
    /**
     * Booleans (not values) indicating whether the operator has wired
     * up a server-level API key for each provider via env / Secret
     * Manager. When true, the user doesn't need to paste their own key
     * — the Settings UI shows a "shared key available" affordance.
     */
    serverKeys: {
        claude: boolean;
        gemini: boolean;
        openai: boolean;
        mistral: boolean;
    };
}

interface UserProfileContextType {
    profile: UserProfile | null;
    loading: boolean;
    updateDisplayName: (name: string) => Promise<boolean>;
    updateOrganisation: (organisation: string) => Promise<boolean>;
    updateModelPreference: (
        field: "tabularModel",
        value: string,
    ) => Promise<boolean>;
    /**
     * Persist the user's reasoning-effort pick to `user_profiles`.
     * Local state flips immediately; the PATCH is fire-and-forget so
     * the picker stays snappy. Returns true on success, false on
     * network error (UI doesn't block on this — the user's pick still
     * applies to the in-flight request via the message payload).
     */
    updateReasoningEffort: (
        value: "low" | "medium" | "high",
    ) => Promise<boolean>;
    updateApiKey: (
        provider: "claude" | "gemini" | "openai" | "mistral",
        value: string | null,
    ) => Promise<boolean>;
    reloadProfile: () => Promise<void>;
    incrementMessageCredits: () => Promise<boolean>;
}

const UserProfileContext = createContext<UserProfileContextType | undefined>(
    undefined,
);

const API_BASE =
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3001";

const MONTHLY_CREDIT_LIMIT = 999999; // temporarily unlimited

import { getStoredTokens } from "@/lib/oauth";

function authHeaders(): Record<string, string> {
    const tokens = getStoredTokens();
    if (!tokens?.access_token) return {};
    return { Authorization: `Bearer ${tokens.access_token}` };
}

async function fetchProfile(): Promise<any> {
    const res = await fetch(`${API_BASE}/user/profile`, {
        headers: { Accept: "application/json", ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);
    return res.json();
}

async function patchProfile(updates: Record<string, any>): Promise<void> {
    const res = await fetch(`${API_BASE}/user/profile`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
        },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Profile update failed: ${res.status}`);
}

function mapServerProfile(data: any): UserProfile {
    const creditsUsed = data.message_credits_used ?? 0;
    const rawEffort = data.reasoning_effort;
    const reasoningEffort: "low" | "medium" | "high" =
        rawEffort === "low" || rawEffort === "medium" || rawEffort === "high"
            ? rawEffort
            : "high";
    return {
        displayName: data.display_name ?? null,
        organisation: data.organisation ?? null,
        messageCreditsUsed: creditsUsed,
        creditsResetDate:
            data.credits_reset_date ??
            new Date(Date.now() + 30 * 86400000).toISOString(),
        creditsRemaining: MONTHLY_CREDIT_LIMIT - creditsUsed,
        tier: data.tier || "Free",
        tabularModel: data.tabular_model || "claude-sonnet-4-6",
        reasoningEffort,
        claudeApiKey: data.claude_api_key ?? null,
        geminiApiKey: data.gemini_api_key ?? null,
        openaiApiKey: data.openai_api_key ?? null,
        mistralApiKey: data.mistral_api_key ?? null,
        serverKeys: {
            claude: !!data.server_keys?.claude,
            gemini: !!data.server_keys?.gemini,
            openai: !!data.server_keys?.openai,
            mistral: !!data.server_keys?.mistral,
        },
    };
}

const DEFAULT_PROFILE: UserProfile = {
    displayName: null,
    organisation: null,
    messageCreditsUsed: 0,
    creditsResetDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    creditsRemaining: MONTHLY_CREDIT_LIMIT,
    tier: "Free",
    tabularModel: "claude-sonnet-4-6",
    reasoningEffort: "high",
    claudeApiKey: null,
    geminiApiKey: null,
    openaiApiKey: null,
    mistralApiKey: null,
    serverKeys: {
        claude: false,
        gemini: false,
        openai: false,
        mistral: false,
    },
};

export function UserProfileProvider({ children }: { children: ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    const loadProfile = useCallback(async () => {
        try {
            const data = await fetchProfile();
            const mapped = mapServerProfile(data);

            // Auto-reset credits if past the reset date
            if (
                mapped.creditsResetDate &&
                new Date() > new Date(mapped.creditsResetDate)
            ) {
                const newResetDate = new Date(
                    Date.now() + 30 * 86400000,
                ).toISOString();
                setProfile({
                    ...mapped,
                    messageCreditsUsed: 0,
                    creditsResetDate: newResetDate,
                    creditsRemaining: MONTHLY_CREDIT_LIMIT,
                });
                // Background DB update
                patchProfile({
                    message_credits_used: 0,
                    credits_reset_date: newResetDate,
                }).catch((err) =>
                    console.error("Failed to auto-reset credits", err),
                );
            } else {
                setProfile(mapped);
            }
        } catch {
            setProfile(DEFAULT_PROFILE);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated && user) {
            setLoading(true);
            loadProfile();
        } else {
            setProfile(null);
            setLoading(false);
        }
    }, [isAuthenticated, user, loadProfile]);

    const updateDisplayName = useCallback(
        async (displayName: string): Promise<boolean> => {
            if (!user) return false;
            try {
                await patchProfile({ display_name: displayName });
                setProfile((prev) => (prev ? { ...prev, displayName } : null));
                return true;
            } catch {
                return false;
            }
        },
        [user],
    );

    const updateOrganisation = useCallback(
        async (organisation: string): Promise<boolean> => {
            if (!user) return false;
            try {
                await patchProfile({ organisation });
                setProfile((prev) =>
                    prev ? { ...prev, organisation } : null,
                );
                return true;
            } catch {
                return false;
            }
        },
        [user],
    );

    const updateModelPreference = useCallback(
        async (
            field: "tabularModel",
            value: string,
        ): Promise<boolean> => {
            if (!user) return false;
            const dbField = field === "tabularModel" ? "tabular_model" : "";
            if (!dbField) return false;
            try {
                await patchProfile({ [dbField]: value });
                setProfile((prev) =>
                    prev ? { ...prev, [field]: value } : null,
                );
                return true;
            } catch {
                return false;
            }
        },
        [user],
    );

    const updateReasoningEffort = useCallback(
        async (value: "low" | "medium" | "high"): Promise<boolean> => {
            if (!user) return false;
            // Optimistic local update so the picker doesn't lag on the
            // network round-trip — backend validates the value too
            // (CHECK constraint + route guard) so we won't desync.
            setProfile((prev) =>
                prev ? { ...prev, reasoningEffort: value } : null,
            );
            try {
                await patchProfile({ reasoning_effort: value });
                return true;
            } catch {
                return false;
            }
        },
        [user],
    );

    const updateApiKey = useCallback(
        async (
            provider: "claude" | "gemini" | "openai" | "mistral",
            value: string | null,
        ): Promise<boolean> => {
            if (!user) return false;
            const dbField =
                provider === "claude"
                    ? "claude_api_key"
                    : provider === "openai"
                      ? "openai_api_key"
                      : provider === "mistral"
                        ? "mistral_api_key"
                        : "gemini_api_key";
            const stateField =
                provider === "claude"
                    ? "claudeApiKey"
                    : provider === "openai"
                      ? "openaiApiKey"
                      : provider === "mistral"
                        ? "mistralApiKey"
                        : "geminiApiKey";
            const normalized = value?.trim() ? value.trim() : null;
            try {
                await patchProfile({ [dbField]: normalized });
                setProfile((prev) =>
                    prev ? { ...prev, [stateField]: normalized } : null,
                );
                return true;
            } catch {
                return false;
            }
        },
        [user],
    );

    const reloadProfile = useCallback(async () => {
        if (user) {
            await loadProfile();
        }
    }, [user, loadProfile]);

    const incrementMessageCredits = useCallback(async (): Promise<boolean> => {
        if (!user || !profile) return false;
        if (profile.creditsRemaining <= 0) return false;

        try {
            const newCreditsUsed = profile.messageCreditsUsed + 1;
            await patchProfile({ message_credits_used: newCreditsUsed });
            setProfile((prev) =>
                prev
                    ? {
                          ...prev,
                          messageCreditsUsed: newCreditsUsed,
                          creditsRemaining: MONTHLY_CREDIT_LIMIT - newCreditsUsed,
                      }
                    : null,
            );
            return true;
        } catch {
            return false;
        }
    }, [user, profile]);

    return (
        <UserProfileContext.Provider
            value={{
                profile,
                loading,
                updateDisplayName,
                updateOrganisation,
                updateModelPreference,
                updateReasoningEffort,
                updateApiKey,
                reloadProfile,
                incrementMessageCredits,
            }}
        >
            {children}
        </UserProfileContext.Provider>
    );
}

export function useUserProfile() {
    const context = useContext(UserProfileContext);
    if (context === undefined) {
        throw new Error(
            "useUserProfile must be used within a UserProfileProvider",
        );
    }
    return context;
}
