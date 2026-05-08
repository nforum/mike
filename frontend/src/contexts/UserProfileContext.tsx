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
    claudeApiKey: string | null;
    geminiApiKey: string | null;
    openaiApiKey: string | null;
    mistralApiKey: string | null;
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
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

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
    return {
        displayName: data.display_name ?? null,
        organisation: data.organisation ?? null,
        messageCreditsUsed: creditsUsed,
        creditsResetDate:
            data.credits_reset_date ??
            new Date(Date.now() + 30 * 86400000).toISOString(),
        creditsRemaining: MONTHLY_CREDIT_LIMIT - creditsUsed,
        tier: data.tier || "Free",
        tabularModel: data.tabular_model || "gemini-3-flash-preview",
        claudeApiKey: data.claude_api_key ?? null,
        geminiApiKey: data.gemini_api_key ?? null,
        openaiApiKey: data.openai_api_key ?? null,
        mistralApiKey: data.mistral_api_key ?? null,
    };
}

const DEFAULT_PROFILE: UserProfile = {
    displayName: null,
    organisation: null,
    messageCreditsUsed: 0,
    creditsResetDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    creditsRemaining: MONTHLY_CREDIT_LIMIT,
    tier: "Free",
    tabularModel: "gemini-3-flash-preview",
    claudeApiKey: null,
    geminiApiKey: null,
    openaiApiKey: null,
    mistralApiKey: null,
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
