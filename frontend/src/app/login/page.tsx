"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SiteLogo } from "@/components/site-logo";
import { useAuth } from "@/contexts/AuthContext";
import {
    startAuthorizationFlow,
    stashPostLoginRedirect,
    consumePostLoginRedirect,
} from "@/lib/oauth";

export default function LoginPage() {
    const router = useRouter();
    const { isAuthenticated, authLoading } = useAuth();
    const t = useTranslations("login");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const autoLoginTriggered = useRef(false);

    // Stash the deep-link target as early as possible — the OAuth round
    // trip will wipe the URL by the time we land back here. Same-origin
    // whitelist enforced inside `stashPostLoginRedirect`.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const raw = params.get("next") ?? params.get("redirect");
        if (raw) stashPostLoginRedirect(raw);
    }, []);

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            const next = consumePostLoginRedirect();
            router.replace(next ?? "/assistant");
        }
    }, [authLoading, isAuthenticated, router]);

    // After social login (Google/LinkedIn), WordPress sets a session and
    // redirects back here with ?social_done=1. Auto-trigger the OAuth PKCE
    // flow immediately so the user lands in the app without an extra click.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        if (params.get("social_done") !== "1") return;
        if (autoLoginTriggered.current) return;
        autoLoginTriggered.current = true;
        setLoading(true);
        setError(null);
        startAuthorizationFlow()
            .then((url) => { window.location.href = url; })
            .catch((err: any) => {
                setError(err.message || "Failed to start login flow");
                setLoading(false);
            });
    }, []);

    const handleLogin = async () => {
        setLoading(true);
        setError(null);
        try {
            const url = await startAuthorizationFlow();
            window.location.href = url;
        } catch (err: any) {
            setError(err.message || "Failed to start login flow");
            setLoading(false);
        }
    };

    const handleSocialLogin = async (provider: "google" | "linkedin") => {
        setLoading(true);
        setError(null);
        try {
            // Start the PKCE flow first — this stores verifier+state in sessionStorage
            // so they survive the cross-origin redirect round-trip.
            const oauthUrl = await startAuthorizationFlow();

            // After WordPress social login, redirect back to our OAuth authorize URL
            // so it auto-completes the PKCE exchange (user is already logged in at this point).
            // We encode it as redirect_to so WordPress forwards us there post-login.
            const returnUrl = oauthUrl; // Full eulex.ai/authorize?code_challenge=...&state=...

            const baseUrl = "https://eulex.ai";
            const url =
                provider === "google"
                    ? `${baseUrl}/google-auth-start?context=login&redirect_to=${encodeURIComponent(returnUrl)}`
                    : `${baseUrl}/linkedin-auth-start?context=login&redirect_to=${encodeURIComponent(returnUrl)}`;
            window.location.href = url;
        } catch (err: any) {
            setError(err.message || "Failed to start login flow");
            setLoading(false);
        }
    };

    return (
        <div className="min-h-dvh bg-white flex items-start justify-center px-6 pt-32 md:pt-40 pb-10 relative">
            <div className="absolute top-4 md:top-8 left-1/2 -translate-x-1/2">
                <SiteLogo size="md" className="md:text-4xl" asLink />
            </div>
            <div className="w-full max-w-md">
                {/* Login Card */}
                <div className="bg-white border border-gray-200 rounded-2xl p-8">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-left text-2xl font-serif">
                            {t("title")}
                        </h2>
                        <div className="bg-gray-100 p-1 rounded-md flex text-xs font-medium">
                            <span className="text-gray-600 px-3 py-1 bg-white rounded-sm shadow-sm">
                                {t("logIn")}
                            </span>
                            <a
                                href="https://eulex.ai/signup"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1 text-gray-500 hover:text-gray-900"
                            >
                                {t("signUp")}
                            </a>
                        </div>
                    </div>

                    {/* Primary OAuth Login */}
                    <Button
                        onClick={handleLogin}
                        disabled={loading}
                        className="w-full bg-black hover:bg-gray-900 text-white py-6 text-base"
                    >
                        {loading ? (
                            <span className="flex items-center gap-2">
                                <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                                {t("redirecting")}
                            </span>
                        ) : (
                            t("signInWithEulex")
                        )}
                    </Button>

                    {/* Divider */}
                    <div className="flex items-center gap-3 my-5">
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className="text-xs text-gray-400 uppercase">{t("orContinueWith")}</span>
                        <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Social Login Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={() => handleSocialLogin("google")}
                            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                                    fill="#4285F4"
                                />
                                <path
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                    fill="#34A853"
                                />
                                <path
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                    fill="#FBBC05"
                                />
                                <path
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                    fill="#EA4335"
                                />
                            </svg>
                            {t("google")}
                        </button>
                        <button
                            onClick={() => handleSocialLogin("linkedin")}
                            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#0A66C2">
                                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                            </svg>
                            {t("linkedIn")}
                        </button>
                    </div>

                    {error && (
                        <div className="mt-4 text-red-600 text-sm bg-red-50 p-3 rounded">
                            {error}
                        </div>
                    )}

                    {/* Info text */}
                    <p className="mt-5 text-center text-xs text-gray-400">
                        {t("noAccount")}{" "}
                        <a
                            href="https://eulex.ai/signup"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                        >
                            {t("createAccount")}
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
}
