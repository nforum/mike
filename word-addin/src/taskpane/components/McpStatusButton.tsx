/**
 * Compact MCP connector status button anchored top-right of the add-in.
 * Pairs with `useMcpServers`, which auto-enables every connector once on
 * sign-in. The button:
 *
 *   - shows a Plug icon, blue when ≥1 connector is enabled and healthy,
 *     gray otherwise (no connectors / all disabled),
 *   - badges with a small dot when any connector reports a `last_error`
 *     (typical case: an OAuth connector needs re-auth in the web app),
 *   - opens a lightweight popover on click listing each connector and
 *     its current state — read-only here, since auto-enable already
 *     keeps things on; full management lives in the Max web app.
 *
 * Implementation note: we don't pull in Radix in the add-in to keep the
 * webpack bundle small, so the popover is a hand-rolled absolute-
 * positioned div with an outside-click + Escape handler.
 */

import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Plug } from "lucide-react";
import type { McpServer } from "../lib/api";
import { useTranslation } from "../i18n/I18nProvider";

interface Props {
    servers: McpServer[];
    loading: boolean;
    /**
     * `inline` flips the component from "absolutely positioned floating
     * chrome" to "in-flow toolbar button". The popover then opens upward
     * (`bottom-7`) instead of downward, since the inline placement is in
     * the chat input toolbar at the bottom of the pane and there is no
     * vertical space below it.
     */
    inline?: boolean;
}

export default function McpStatusButton({ servers, loading, inline }: Props) {
    const t = useTranslation();
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (
                wrapRef.current &&
                !wrapRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    if (!loading && servers.length === 0) {
        // Nothing configured — keep the chrome quiet.
        return null;
    }

    const healthy = servers.filter((s) => s.enabled && !s.last_error);
    const hasError = servers.some((s) => s.enabled && s.last_error);
    const isActive = healthy.length > 0;

    const tooltip = loading
        ? t("mcp.loading")
        : t("mcp.status", {
              enabled: healthy.length,
              total: servers.length,
          });

    if (inline) {
        return (
            <div ref={wrapRef} className="relative">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    title={tooltip}
                    aria-label={t("mcp.aria")}
                    className={`relative inline-flex items-center gap-1 px-2 h-7 text-xs rounded-md border transition-colors ${
                        isActive
                            ? "border-mike-200 bg-mike-50 text-mike-700"
                            : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    } ${open ? "ring-2 ring-mike-200" : ""}`}
                >
                    <Plug className="h-3 w-3" />
                    <span>{t("mcp.title")}</span>
                    <span
                        className={`text-[10px] tabular-nums ${
                            isActive ? "text-mike-600" : "text-gray-400"
                        }`}
                    >
                        {healthy.length}/{servers.length}
                    </span>
                    {hasError && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                    )}
                </button>

                {open && (
                    <div className="absolute left-0 bottom-9 w-60 rounded-md border border-gray-200 bg-white shadow-lg p-1.5 text-xs z-20">
                        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-400">
                            {t("mcp.title")}
                        </div>
                        {loading && servers.length === 0 ? (
                            <div className="px-2 py-1.5 text-gray-500">
                                {t("mcp.loading")}
                            </div>
                        ) : (
                            servers.map((s) => (
                                <McpRow key={s.id} server={s} t={t} />
                            ))
                        )}
                        <div className="border-t border-gray-100 mt-1 pt-1 px-2 text-[10px] text-gray-400">
                            {t("mcp.manageHint")}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div ref={wrapRef} className="absolute top-1.5 right-14 z-10">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                title={tooltip}
                aria-label={t("mcp.aria")}
                className={`relative flex items-center justify-center w-6 h-6 rounded transition-colors ${
                    isActive
                        ? "text-blue-600 hover:bg-blue-50"
                        : "text-gray-300 hover:text-gray-500"
                } ${open ? "bg-gray-100" : ""}`}
            >
                <Plug className="w-3.5 h-3.5" />
                {hasError && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                )}
            </button>

            {open && (
                <div className="absolute right-0 top-7 w-60 rounded-md border border-gray-200 bg-white shadow-lg p-1.5 text-xs">
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-400">
                        {t("mcp.title")}
                    </div>
                    {loading && servers.length === 0 ? (
                        <div className="px-2 py-1.5 text-gray-500">
                            {t("mcp.loading")}
                        </div>
                    ) : (
                        servers.map((s) => (
                            <McpRow key={s.id} server={s} t={t} />
                        ))
                    )}
                    <div className="border-t border-gray-100 mt-1 pt-1 px-2 text-[10px] text-gray-400">
                        {t("mcp.manageHint")}
                    </div>
                </div>
            )}
        </div>
    );
}

function McpRow({
    server,
    t,
}: {
    server: McpServer;
    t: ReturnType<typeof useTranslation>;
}) {
    const name = server.name.trim() || server.slug || t("mcp.untitled");
    const errored = !!server.last_error;
    const reauth = server.last_error === "reauth_required";

    let stateLabel: string;
    let stateClass: string;
    if (!server.enabled) {
        stateLabel = t("mcp.off");
        stateClass = "text-gray-400";
    } else if (reauth) {
        stateLabel = t("mcp.reauth");
        stateClass = "text-amber-600";
    } else if (errored) {
        stateLabel = t("mcp.error");
        stateClass = "text-red-600";
    } else {
        stateLabel = t("mcp.on");
        stateClass = "text-blue-600";
    }

    return (
        <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-gray-50">
            <span className="flex items-center gap-1.5 min-w-0">
                <Plug className="w-3 h-3 text-gray-400 shrink-0" />
                <span className="truncate text-gray-700">{name}</span>
                {errored && !reauth && (
                    <AlertCircle
                        className="w-3 h-3 text-red-500 shrink-0"
                        aria-label={server.last_error ?? ""}
                    />
                )}
            </span>
            <span className={`shrink-0 text-[10px] font-medium ${stateClass}`}>
                {stateLabel}
            </span>
        </div>
    );
}
