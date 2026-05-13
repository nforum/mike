"use client";

/**
 * Email-bound chat share landing page (deep link from invite email).
 *
 * Lives OUTSIDE the `(pages)` route group on purpose:
 *   - the (pages) layout force-redirects unauthenticated users to /login
 *     without preserving the deep link; we need `/login?next=/share/<token>`
 *     so the recipient lands back here after sign-in
 *   - the share view is a standalone snapshot — sidebar + chat history
 *     navigation would be confusing for a recipient who has no chats
 *     of their own yet
 *
 * Backend contract: GET /share/:token returns a structured `code` on
 * failure (`email_mismatch`, `expired`, `revoked`, `not_found`,
 * `chat_missing`) so we can render distinct UX for each.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
    ArrowRight,
    Loader2,
    MailWarning,
    ShieldAlert,
    Clock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
    getSharedChat,
    acceptSharedChat,
    type SharedChatView,
} from "@/app/lib/mikeApi";
import { UserMessage } from "@/app/components/assistant/UserMessage";
import { AssistantMessage } from "@/app/components/assistant/AssistantMessage";
import { SiteLogo } from "@/components/site-logo";

type ErrorCode =
    | "email_mismatch"
    | "expired"
    | "revoked"
    | "not_found"
    | "chat_missing"
    | "unknown";

interface ApiErrorBody {
    detail?: string;
    code?: ErrorCode;
    expectedEmail?: string;
}

function parseApiError(err: unknown): ApiErrorBody {
    const raw = err instanceof Error ? err.message : String(err);
    try {
        return JSON.parse(raw) as ApiErrorBody;
    } catch {
        return { detail: raw };
    }
}

export default function SharedChatPage() {
    const params = useParams();
    const router = useRouter();
    const { isAuthenticated, authLoading } = useAuth();
    const t = useTranslations("shareChat");

    const token = (params?.token as string | undefined) ?? "";

    const [view, setView] = useState<SharedChatView | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<ApiErrorBody | null>(null);
    const [accepting, setAccepting] = useState(false);

    // If we land here without a session, send the user to /login with a
    // same-origin `next` parameter so they return here after auth.
    useEffect(() => {
        if (authLoading) return;
        if (!isAuthenticated) {
            const next = `/share/${encodeURIComponent(token)}`;
            router.replace(`/login?next=${encodeURIComponent(next)}`);
        }
    }, [authLoading, isAuthenticated, router, token]);

    useEffect(() => {
        if (authLoading || !isAuthenticated || !token) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        getSharedChat(token)
            .then((data) => {
                if (cancelled) return;
                setView(data);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(parseApiError(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [authLoading, isAuthenticated, token]);

    async function handleContinue() {
        if (!view || accepting) return;
        setAccepting(true);
        try {
            const res = await acceptSharedChat(token);
            router.replace(res.redirect_to);
        } catch (err) {
            setError(parseApiError(err));
            setAccepting(false);
        }
    }

    if (authLoading || !isAuthenticated) {
        return <CenteredSpinner />;
    }

    if (loading) {
        return <CenteredSpinner />;
    }

    if (error) {
        return <ShareErrorScreen error={error} />;
    }

    if (!view) {
        return <ShareErrorScreen error={{ code: "not_found" }} />;
    }

    const ownerLabel =
        view.owner.display_name?.trim() ||
        view.owner.email ||
        t("ownerFallback");
    const sharedDate = formatDate(view.shared_at);
    const expiryDate = formatDate(view.expires_at);
    const isLive = view.mode === "live";

    return (
        <div className="min-h-dvh bg-white flex flex-col">
            <header className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                <SiteLogo size="sm" asLink />
                <button
                    onClick={handleContinue}
                    disabled={accepting}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-40 transition-colors"
                >
                    {accepting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <ArrowRight className="h-4 w-4" />
                    )}
                    {isLive ? t("openInChat") : t("continueConversation")}
                </button>
            </header>

            <div className="px-6 pt-6 pb-2 max-w-3xl mx-auto w-full">
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                    <p className="font-medium text-gray-900">
                        {t("snapshotBannerTitle", { name: ownerLabel })}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                        {isLive
                            ? t("snapshotBannerLive")
                            : t("snapshotBannerHint", { date: sharedDate })}
                        {" · "}
                        {t("expiresOn", { date: expiryDate })}
                    </p>
                </div>
            </div>

            <main className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
                    {view.chat.title && (
                        <h1 className="text-2xl font-serif text-gray-900">
                            {view.chat.title}
                        </h1>
                    )}
                    {view.messages.length === 0 ? (
                        <p className="text-sm text-gray-400">{t("emptyChat")}</p>
                    ) : (
                        view.messages.map((m, i) =>
                            m.role === "user" ? (
                                <UserMessage
                                    key={i}
                                    content={m.content ?? ""}
                                    files={(m as { files?: { filename: string }[] }).files}
                                    workflow={
                                        (m as { workflow?: { id: string; title: string } })
                                            .workflow
                                    }
                                />
                            ) : (
                                <AssistantMessage
                                    key={i}
                                    content={m.content ?? ""}
                                    events={m.events}
                                    annotations={m.annotations}
                                />
                            ),
                        )
                    )}
                </div>
            </main>

            <footer className="border-t border-gray-100 px-6 py-4 shrink-0">
                <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
                    <p className="text-xs text-gray-500">
                        {t("continueExplainer")}
                    </p>
                    <button
                        onClick={handleContinue}
                        disabled={accepting}
                        className="inline-flex items-center gap-2 rounded-lg bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-40 transition-colors"
                    >
                        {accepting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <ArrowRight className="h-4 w-4" />
                        )}
                        {isLive ? t("openInChat") : t("continueConversation")}
                    </button>
                </div>
            </footer>
        </div>
    );
}

function CenteredSpinner() {
    return (
        <div className="min-h-dvh flex items-center justify-center bg-white">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
    );
}

function ShareErrorScreen({ error }: { error: ApiErrorBody }) {
    const t = useTranslations("shareChat");
    const code = (error.code ?? "unknown") as ErrorCode;

    let title: string;
    let body: string;
    let Icon = ShieldAlert;
    if (code === "email_mismatch") {
        title = t("errorEmailMismatchTitle");
        body = error.expectedEmail
            ? t("errorEmailMismatchBodyWithEmail", {
                  email: error.expectedEmail,
              })
            : t("errorEmailMismatchBody");
        Icon = MailWarning;
    } else if (code === "expired" || code === "revoked") {
        title = t("errorExpiredTitle");
        body = t("errorExpiredBody");
        Icon = Clock;
    } else {
        title = t("errorNotFoundTitle");
        body = t("errorNotFoundBody");
    }

    return (
        <div className="min-h-dvh flex flex-col bg-white">
            <header className="px-6 py-4 border-b border-gray-100">
                <SiteLogo size="sm" asLink />
            </header>
            <div className="flex-1 flex items-center justify-center px-6">
                <div className="max-w-md w-full rounded-2xl border border-gray-200 bg-white p-8 text-center">
                    <Icon className="h-8 w-8 text-gray-400 mx-auto mb-4" />
                    <h1 className="text-xl font-serif text-gray-900 mb-2">
                        {title}
                    </h1>
                    <p className="text-sm text-gray-500">{body}</p>
                    {error.detail && code === "unknown" && (
                        <p className="mt-3 text-xs text-gray-400">
                            {error.detail}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    try {
        const d = new Date(iso);
        return new Intl.DateTimeFormat(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric",
        }).format(d);
    } catch {
        return iso;
    }
}
