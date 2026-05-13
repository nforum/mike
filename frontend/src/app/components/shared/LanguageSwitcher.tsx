"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import type { Locale } from "@/i18n/request";
import { getStoredTokens } from "@/lib/oauth";

const LOCALES: { code: Locale; flag: string }[] = [
    { code: "en", flag: "🇬🇧" },
    { code: "hr", flag: "🇭🇷" },
];

const API_BASE =
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3001";

/**
 * Fire-and-forget mirror of the chosen locale into the user profile.
 *
 * The web frontend itself runs on the cookie alone — `next-intl` reads
 * `NEXT_LOCALE` server-side. We persist `preferred_language` so clients
 * that can't see this cookie (most importantly the Word add-in's
 * sandboxed Office.js WebView, which has its own cookie jar) can fetch
 * the same locale on sign-in.
 *
 * Failures are swallowed: the language switch is already cosmetically
 * complete client-side, so we don't want a transient backend hiccup to
 * show an error toast on every switch.
 */
function persistPreferredLanguage(locale: Locale): void {
    const tokens = getStoredTokens();
    if (!tokens?.access_token) return;
    void fetch(`${API_BASE}/user/profile`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokens.access_token}`,
        },
        body: JSON.stringify({ preferred_language: locale }),
    }).catch(() => {
        /* non-blocking */
    });
}

export function LanguageSwitcher() {
    const locale = useLocale();
    const t = useTranslations("language");
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const handleSwitch = (nextLocale: Locale) => {
        if (nextLocale === locale) return;
        document.cookie = `NEXT_LOCALE=${nextLocale};path=/;max-age=31536000;SameSite=Lax`;
        persistPreferredLanguage(nextLocale);
        startTransition(() => {
            router.refresh();
        });
    };

    const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
    const other = LOCALES.find((l) => l.code !== locale) ?? LOCALES[1];

    return (
        <button
            type="button"
            onClick={() => handleSwitch(other.code)}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors disabled:opacity-50"
            title={t("label")}
        >
            <Globe className="h-3.5 w-3.5" />
            <span>{current.flag} {t(locale as "en" | "hr")}</span>
        </button>
    );
}
