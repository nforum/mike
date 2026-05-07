"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    useCallback,
    ReactNode,
} from "react";
import {
    getStoredTokens,
    isAccessTokenExpired,
    refreshAccessToken,
    decodeJwtPayload,
    signOut as oauthSignOut,
    type OAuthUser,
} from "@/lib/oauth";

interface AuthContextType {
    user: OAuthUser | null;
    isAuthenticated: boolean;
    authLoading: boolean;
    tier: "free" | "plus";
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<OAuthUser | null>(null);
    const [authLoading, setAuthLoading] = useState(true);

    const loadUser = useCallback(async () => {
        const tokens = getStoredTokens();
        if (!tokens) {
            setUser(null);
            setAuthLoading(false);
            return;
        }

        // If access token expired, try refresh
        if (isAccessTokenExpired()) {
            const refreshed = await refreshAccessToken();
            if (!refreshed) {
                setUser(null);
                setAuthLoading(false);
                return;
            }

            const decoded = decodeJwtPayload(refreshed.access_token);
            setUser(decoded);
            setAuthLoading(false);
            return;
        }

        // Token is still valid — decode for user info
        const decoded = decodeJwtPayload(tokens.access_token);
        setUser(decoded);
        setAuthLoading(false);
    }, []);

    useEffect(() => {
        loadUser();

        // Listen for token changes from other tabs
        const onStorage = (e: StorageEvent) => {
            if (e.key === "mike_oauth_tokens") {
                loadUser();
            }
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, [loadUser]);

    const handleSignOut = async () => {
        await oauthSignOut();
        setUser(null);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                isAuthenticated: !!user,
                authLoading,
                tier: user?.tier ?? "free",
                signOut: handleSignOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
