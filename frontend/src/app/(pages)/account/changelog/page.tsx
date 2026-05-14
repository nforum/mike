"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type LocaleCode = "en" | "hr";

type LocalizedString = string | Partial<Record<LocaleCode, string>>;

type ChangeType =
    | "added"
    | "improved"
    | "changed"
    | "fixed"
    | "removed"
    | "security";

interface ChangelogChange {
    type: ChangeType;
    text: LocalizedString;
}

interface ChangelogEntry {
    version: string;
    date: string;
    title?: LocalizedString;
    changes: ChangelogChange[];
}

interface ChangelogFile {
    entries: ChangelogEntry[];
}

const KNOWN_TYPES: readonly ChangeType[] = [
    "added",
    "improved",
    "changed",
    "fixed",
    "removed",
    "security",
];

function pickLocalized(
    value: LocalizedString | undefined,
    locale: LocaleCode,
): string {
    if (!value) return "";
    if (typeof value === "string") return value;
    return value[locale] ?? value.en ?? value.hr ?? "";
}

function formatDate(iso: string, locale: LocaleCode): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    try {
        return new Intl.DateTimeFormat(locale === "hr" ? "hr-HR" : "en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
        }).format(d);
    } catch {
        return iso;
    }
}

const TYPE_BADGE_CLASSES: Record<ChangeType, string> = {
    added: "bg-emerald-50 text-emerald-700 border-emerald-200",
    improved: "bg-sky-50 text-sky-700 border-sky-200",
    changed: "bg-amber-50 text-amber-700 border-amber-200",
    fixed: "bg-blue-50 text-blue-700 border-blue-200",
    removed: "bg-rose-50 text-rose-700 border-rose-200",
    security: "bg-purple-50 text-purple-700 border-purple-200",
};

export default function ChangelogPage() {
    const t = useTranslations("changelog");
    const rawLocale = useLocale();
    const locale: LocaleCode = rawLocale === "hr" ? "hr" : "en";

    const [data, setData] = useState<ChangelogFile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetch("/changelog.json", { cache: "no-store" })
            .then(async (res) => {
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                return (await res.json()) as ChangelogFile;
            })
            .then((parsed) => {
                if (cancelled) return;
                setData(parsed);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const sortedEntries = useMemo(() => {
        if (!data?.entries) return [];
        return [...data.entries].sort((a, b) => {
            const da = new Date(a.date).getTime();
            const db = new Date(b.date).getTime();
            if (Number.isNaN(da) || Number.isNaN(db)) return 0;
            return db - da;
        });
    }, [data]);

    return (
        <div className="space-y-6">
            <div className="pb-2">
                <h2 className="text-2xl font-medium font-serif mb-2">
                    {t("title")}
                </h2>
                <p className="text-sm text-gray-600 max-w-2xl">
                    {t("description")}
                </p>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t("loading")}</span>
                </div>
            ) : error ? (
                <div className="flex items-start gap-2 text-sm text-red-600 rounded-lg border border-red-200 bg-red-50 p-3">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex flex-col">
                        <span className="font-medium">
                            {t("errors.loadFailed")}
                        </span>
                        <span className="text-red-700/80">{error}</span>
                    </div>
                </div>
            ) : sortedEntries.length === 0 ? (
                <p className="text-sm text-gray-500">{t("empty")}</p>
            ) : (
                <ol className="space-y-6">
                    {sortedEntries.map((entry) => {
                        const title = pickLocalized(entry.title, locale);
                        return (
                            <li
                                key={`${entry.version}-${entry.date}`}
                                className="rounded-lg border border-gray-200 bg-white p-5"
                            >
                                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
                                    <span className="text-lg font-semibold tracking-tight">
                                        v{entry.version}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {formatDate(entry.date, locale)}
                                    </span>
                                    {title ? (
                                        <span className="text-sm text-gray-700 break-words">
                                            — {title}
                                        </span>
                                    ) : null}
                                </div>

                                <ul className="space-y-2">
                                    {entry.changes.map((change, idx) => {
                                        const isKnown = (KNOWN_TYPES as readonly string[]).includes(
                                            change.type,
                                        );
                                        const badgeClass = isKnown
                                            ? TYPE_BADGE_CLASSES[change.type]
                                            : "bg-gray-50 text-gray-700 border-gray-200";
                                        const typeLabel = isKnown
                                            ? t(`types.${change.type}`)
                                            : change.type;
                                        return (
                                            <li
                                                key={idx}
                                                className="flex items-start gap-3 text-sm"
                                            >
                                                <Badge
                                                    variant="outline"
                                                    className={`mt-0.5 ${badgeClass}`}
                                                >
                                                    {typeLabel}
                                                </Badge>
                                                <span className="text-gray-800 leading-relaxed">
                                                    {pickLocalized(
                                                        change.text,
                                                        locale,
                                                    )}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}
