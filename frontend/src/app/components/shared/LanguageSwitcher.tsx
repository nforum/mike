"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import type { Locale } from "@/i18n/request";

const LOCALES: { code: Locale; flag: string }[] = [
    { code: "en", flag: "🇬🇧" },
    { code: "hr", flag: "🇭🇷" },
];

export function LanguageSwitcher() {
    const locale = useLocale();
    const t = useTranslations("language");
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const handleSwitch = (nextLocale: Locale) => {
        if (nextLocale === locale) return;
        document.cookie = `NEXT_LOCALE=${nextLocale};path=/;max-age=31536000;SameSite=Lax`;
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
