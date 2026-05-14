"use client";

import { useId, useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
    Copy,
    Check,
    ChevronDown,
    Download,
    Loader2,
    Share2,
    Printer,
    FileDown,
    Flag,
} from "lucide-react";
import { MikeIcon } from "@/components/chat/mike-icon";
import { setMessageFlag } from "@/app/lib/mikeApi";
import { displayCitationQuote, formatCitationPage } from "../shared/types";
import type {
    AssistantEvent,
    MikeCitationAnnotation,
    MikeEditAnnotation,
} from "../shared/types";
import { EditCard, applyOptimisticResolution } from "./EditCard";
import { PreResponseWrapper } from "../shared/PreResponseWrapper";
import { supabase } from "@/lib/supabase";
import { useTranslations } from "next-intl";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFunc = (key: string, values?: Record<string, any>) => string;

/**
 * Card rendered above the per-edit EditCards when a message produced
 * multiple tracked-change proposals. Lets the user resolve every pending
 * edit in one click by firing the per-edit accept/reject endpoint for each
 * pending annotation and forwarding each response to `onResolved` so the
 * parent can bump the viewer version, persist override URLs, etc.
 *
 * This intentionally doesn't apply the optimistic DOM mutation that
 * EditCard does — bulk operations touch many edits at once and the real
 * re-render from the latest version will reconcile within a second or so.
 */
function BulkEditActions({
    pending,
    filenameByDocId,
    onViewClick,
    onResolveStart,
    onResolved,
    onError,
    t,
}: {
    pending: {
        annotation: MikeEditAnnotation;
        filename: string;
    }[];
    filenameByDocId: Map<string, string>;
    onViewClick?: (ann: MikeEditAnnotation, filename: string) => void;
    onResolveStart?: (args: {
        editId: string;
        documentId: string;
        verb: "accept" | "reject";
    }) => void;
    onResolved?: (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => void;
    onError?: (args: {
        editId: string;
        documentId: string;
        versionId: string | null;
        message: string;
    }) => void;
    t: TFunc;
}) {
    const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
    const [progress, setProgress] = useState<{
        done: number;
        total: number;
    } | null>(null);

    if (pending.length === 0) return null;

    const handleAll = async (verb: "accept" | "reject") => {
        if (busy) return;
        setBusy(verb);
        setProgress({ done: 0, total: pending.length });
        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const token = session?.access_token;
            const apiBase =
                process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3001";

            // Sequential so the per-document version counter advances in a
            // predictable order and the viewer doesn't race between bumps.
            let done = 0;
            for (const { annotation } of pending) {
                onResolveStart?.({
                    editId: annotation.edit_id,
                    documentId: annotation.document_id,
                    verb,
                });
                // Optimistically mutate the DOM so the viewer reflects the
                // resolution immediately. Revert if the backend call fails.
                let revert: (() => void) | null = null;
                try {
                    revert = applyOptimisticResolution(annotation, verb);
                } catch (e) {
                    console.error(
                        "[BulkEditActions] optimistic update threw",
                        e,
                    );
                }
                try {
                    const resp = await fetch(
                        `${apiBase}/single-documents/${annotation.document_id}/edits/${annotation.edit_id}/${verb}`,
                        {
                            method: "POST",
                            headers: token
                                ? { Authorization: `Bearer ${token}` }
                                : undefined,
                        },
                    );
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const data = (await resp.json()) as {
                        ok: boolean;
                        status?: "accepted" | "rejected";
                        version_id: string | null;
                        download_url: string | null;
                    };
                    const nextStatus =
                        data.status ??
                        (verb === "accept" ? "accepted" : "rejected");
                    onResolved?.({
                        editId: annotation.edit_id,
                        documentId: annotation.document_id,
                        status: nextStatus,
                        versionId: data.version_id,
                        downloadUrl: data.download_url,
                    });
                } catch (e) {
                    console.error("[BulkEditActions] resolve failed", e);
                    try {
                        revert?.();
                    } catch (revertErr) {
                        console.error(
                            "[BulkEditActions] revert threw",
                            revertErr,
                        );
                    }
                    onError?.({
                        editId: annotation.edit_id,
                        documentId: annotation.document_id,
                        versionId: annotation.version_id ?? null,
                        message:
                            verb === "accept"
                                ? "Couldn't save one or more accepts."
                                : "Couldn't save one or more rejects.",
                    });
                }
                done++;
                setProgress({ done, total: pending.length });
            }
        } finally {
            setBusy(null);
            setProgress(null);
        }
    };

    // Optional: show a tiny "View first" action so bulk doesn't lose the
    // in-viewer scroll-to behaviour entirely.
    const first = pending[0];

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={() => handleAll("accept")}
                disabled={!!busy}
                className="px-2 py-1 text-xs rounded border border-gray-900 bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 inline-flex items-center gap-1"
            >
                {busy === "accept" && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {t("acceptAll")}
            </button>
            <button
                onClick={() => handleAll("reject")}
                disabled={!!busy}
                className="px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50 inline-flex items-center gap-1"
            >
                {busy === "reject" && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {t("rejectAll")}
            </button>
            {progress && (
                <span className="text-xs font-serif text-gray-500">
                    {progress.done}/{progress.total}
                </span>
            )}
            {onViewClick && first && (
                <button
                    onClick={() =>
                        onViewClick(first.annotation, first.filename)
                    }
                    disabled={!!busy}
                    className="ml-auto px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                    {t("view")}
                </button>
            )}
        </div>
    );
}

/**
 * Wraps the bulk accept/reject card and the per-edit EditCards in a single
 * minimisable container. The bulk actions and summary stay visible in the
 * header; the individual cards collapse via the chevron toggle.
 */
function EditCardsSection({
    pending,
    filenameByDocId,
    cards,
    resolvedCount,
    onViewClick,
    onResolveStart,
    onResolved,
    onError,
    t,
}: {
    pending: {
        annotation: MikeEditAnnotation;
        filename: string;
    }[];
    filenameByDocId: Map<string, string>;
    cards: React.ReactNode[];
    resolvedCount: number;
    onViewClick?: (ann: MikeEditAnnotation, filename: string) => void;
    onResolveStart?: (args: {
        editId: string;
        documentId: string;
        verb: "accept" | "reject";
    }) => void;
    onResolved?: (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => void;
    onError?: (args: {
        editId: string;
        documentId: string;
        versionId: string | null;
        message: string;
    }) => void;
    t: TFunc;
}) {
    const [isOpen, setIsOpen] = useState(true);
    if (cards.length === 0) return null;

    const docCount = filenameByDocId.size;
    const summary =
        pending.length > 0
            ? docCount > 1
                ? t("trackedChangesAcrossDocs", { changeCount: pending.length, docCount })
                : t("trackedChanges", { count: pending.length })
            : docCount > 1
              ? t("resolvedChangesAcrossDocs", { changeCount: resolvedCount, docCount })
              : t("resolvedChanges", { count: resolvedCount });

    return (
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            {/* Row 1: summary + chevron */}
            <div className="flex items-center gap-2 px-3 pt-3">
                <p className="flex-1 min-w-0 text-sm font-serif text-gray-700 truncate">
                    {summary}
                </p>
                <button
                    onClick={() => setIsOpen((v) => !v)}
                    aria-label={isOpen ? t("collapseEdits") : t("expandEdits")}
                    className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                >
                    <ChevronDown
                        className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
                    />
                </button>
            </div>
            {/* Row 2: bulk action buttons */}
            {pending.length > 0 && (
                <div className="px-3 pt-3">
                    <BulkEditActions
                        pending={pending}
                        filenameByDocId={filenameByDocId}
                        onViewClick={onViewClick}
                        onResolveStart={onResolveStart}
                        onResolved={onResolved}
                        onError={onError}
                        t={t}
                    />
                </div>
            )}
            {/* Row 3: collapsible cards list */}
            {isOpen && (
                <div className="flex flex-col gap-2 px-3 pb-3 pt-3">
                    {cards}
                </div>
            )}
            {!isOpen && <div className="pb-3" />}
        </div>
    );
}

// ---------------------------------------------------------------------------
// ResponseStatus
// ---------------------------------------------------------------------------

type StatusState = "active" | "error" | null;

function ResponseStatus({ status }: { status: StatusState }) {
    const [showDone, setShowDone] = useState(false);
    const [doneVisible, setDoneVisible] = useState(false);
    const wasActiveRef = useRef(false);

    const isActive = status === "active";
    const isError = status === "error";

    useEffect(() => {
        if (wasActiveRef.current && !isActive) {
            setShowDone(true);
            setDoneVisible(true);
            const t = setTimeout(() => setDoneVisible(false), 1500);
            return () => clearTimeout(t);
        } else if (!wasActiveRef.current && isActive) {
            setShowDone(false);
            setDoneVisible(false);
        }
        wasActiveRef.current = isActive;
    }, [isActive]);

    return (
        <div className="w-full h-9 flex items-center mb-2">
            <MikeIcon
                spin={isActive}
                done={showDone && doneVisible}
                error={isError}
                mike={!isError && !(showDone && doneVisible)}
                size={22}
            />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Event block components
// ---------------------------------------------------------------------------

const THINKING_KEYS = [
    "thinking",
    "pondering",
    "analyzing",
    "reviewing",
    "reasoning",
] as const;

function ReasoningBlock({
    text,
    isStreaming,
    showConnector,
    t,
}: {
    text: string;
    isStreaming: boolean;
    showConnector?: boolean;
    t: TFunc;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [thinkingIndex, setThinkingIndex] = useState(0);

    useEffect(() => {
        if (!isStreaming) return;
        const interval = setInterval(() => {
            setThinkingIndex((i) => (i + 1) % THINKING_KEYS.length);
        }, 2000);
        return () => clearInterval(interval);
    }, [isStreaming]);

    const showContent = isOpen || isStreaming;

    return (
        <div className="relative">
            {showConnector && (
                <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            <button
                onClick={() => !isStreaming && setIsOpen((v) => !v)}
                className="flex items-center text-sm font-serif text-gray-500 hover:text-gray-600 transition-colors"
            >
                {isStreaming ? (
                    <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                )}
                <span className="font-medium ml-2">
                    {isStreaming
                        ? t(THINKING_KEYS[thinkingIndex])
                        : t("thoughtProcess")}
                </span>
                {!isStreaming && (
                    <ChevronDown
                        size={10}
                        className={`ml-1 self-center transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
                    />
                )}
            </button>
            {showContent && (
                <div className="mt-2 ml-[14px] text-sm font-serif text-gray-400 prose prose-sm max-w-none [&>*]:text-gray-400 [&>*]:text-sm">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            code: ({ node, ...props }) => (
                                <code
                                    className="font-serif text-gray-600"
                                    {...props}
                                />
                            ),
                        }}
                    >
                        {text}
                    </ReactMarkdown>
                </div>
            )}
        </div>
    );
}

function McpToolResultBlock({
    server,
    tool,
    ok,
    args,
    output,
    showConnector,
    t,
}: {
    server: string;
    tool: string;
    ok: boolean;
    args: string;
    output: string;
    showConnector?: boolean;
    t: TFunc;
}) {
    const [expanded, setExpanded] = useState(false);
    const prettyArgs = (() => {
        try {
            const parsed = JSON.parse(args);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return args;
        }
    })();
    const outputPreview = output.split("\n").slice(0, 1).join("\n");
    const outputClamped =
        outputPreview.length > 160
            ? outputPreview.slice(0, 160) + "…"
            : outputPreview;
    return (
        <div className="text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            <div className="flex items-start">
                <div
                    className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${
                        ok ? "bg-green-400" : "bg-red-400"
                    }`}
                />
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="ml-2 min-w-0 flex-1 text-left hover:text-gray-700 transition-colors"
                >
                    <span className="font-medium">{ok ? t("called") : t("failed")}</span>{" "}
                    <span>
                        {server} · {tool}
                    </span>
                    {!expanded && outputClamped && (
                        <span className="ml-2 text-gray-400">
                            — {outputClamped}
                        </span>
                    )}
                    <span className="ml-2 text-xs text-gray-400">
                        {expanded ? t("hideDetails") : t("showDetails")}
                    </span>
                </button>
            </div>
            {expanded && (
                <div className="ml-3.5 mt-2 space-y-2 border-l-2 border-gray-200 pl-3">
                    <div>
                        <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">
                            {t("arguments")}
                        </div>
                        <pre className="text-xs font-mono bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                            {prettyArgs || t("none")}
                        </pre>
                    </div>
                    <div>
                        <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">
                            {t("output")}
                        </div>
                        <pre className="text-xs font-mono bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
                            {output || t("empty")}
                        </pre>
                    </div>
                </div>
            )}
        </div>
    );
}

function WebSearchBlock({
    query,
    provider,
    results,
    error,
    isStreaming,
    showConnector,
    t,
}: {
    query: string;
    provider: string;
    results: {
        title: string;
        url: string;
        snippet: string;
        published_date: string | null;
    }[];
    error: string | null;
    isStreaming?: boolean;
    showConnector?: boolean;
    t: TFunc;
}) {
    const [expanded, setExpanded] = useState(false);
    const hasError = !isStreaming && !!error;
    const count = results.length;
    const label = isStreaming
        ? t("webSearchSearching")
        : hasError
            ? t("webSearchFailed")
            : t("webSearchFound", { count });
    const dotClass = isStreaming
        ? ""
        : hasError
            ? "bg-red-400"
            : count > 0
                ? "bg-green-400"
                : "bg-gray-300";
    return (
        <div className="text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            <div className="flex items-start">
                {isStreaming ? (
                    <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                ) : (
                    <div className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
                )}
                <button
                    type="button"
                    onClick={() => !isStreaming && setExpanded((v) => !v)}
                    disabled={isStreaming || (count === 0 && !hasError)}
                    className="ml-2 min-w-0 flex-1 text-left hover:text-gray-700 transition-colors disabled:cursor-default disabled:hover:text-gray-500"
                >
                    <span className="font-medium">{label}</span>{" "}
                    <span>
                        &ldquo;{query}&rdquo;
                        <span className="ml-1 text-gray-400">
                            {t("webSearchVia", { provider })}
                        </span>
                        {isStreaming && "..."}
                    </span>
                    {!isStreaming && count > 0 && (
                        <span className="ml-2 text-xs text-gray-400">
                            {expanded ? t("hideDetails") : t("showDetails")}
                        </span>
                    )}
                </button>
            </div>
            {expanded && !isStreaming && (
                <div className="ml-3.5 mt-2 border-l-2 border-gray-200 pl-3 space-y-2">
                    {hasError && (
                        <div className="text-xs text-red-500 break-words">
                            {error}
                        </div>
                    )}
                    {results.map((r, idx) => (
                        <a
                            key={`${r.url}-${idx}`}
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors p-2"
                        >
                            <div className="text-[13px] font-medium text-blue-600 hover:underline truncate">
                                {r.title || r.url}
                            </div>
                            <div className="text-[11px] text-gray-500 truncate">
                                {r.url}
                                {r.published_date ? ` · ${r.published_date}` : ""}
                            </div>
                            {r.snippet && (
                                <div className="text-[12px] text-gray-600 mt-1 line-clamp-2">
                                    {r.snippet}
                                </div>
                            )}
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
}

function DocReadBlock({
    filename,
    onClick,
    showConnector,
    isStreaming,
    t,
}: {
    filename: string;
    onClick?: () => void;
    showConnector?: boolean;
    isStreaming?: boolean;
    t: TFunc;
}) {
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
            ) : (
                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">
                    {isStreaming ? t("reading") : t("read")}
                </span>{" "}
                {isStreaming ? (
                    <span>{filename}...</span>
                ) : onClick ? (
                    <button
                        onClick={onClick}
                        className="text-left hover:text-gray-700 transition-colors cursor-pointer"
                    >
                        {filename}
                    </button>
                ) : (
                    <span>{filename}</span>
                )}
            </div>
        </div>
    );
}

function DocFindBlock({
    filename,
    query,
    totalMatches,
    isStreaming,
    showConnector,
    t,
}: {
    filename: string;
    query: string;
    totalMatches: number;
    isStreaming?: boolean;
    showConnector?: boolean;
    t: TFunc;
}) {
    const label = isStreaming ? t("finding") : t("found");
    const matchSuffix = isStreaming
        ? ""
        : ` (${t("matchCount", { count: totalMatches })})`;
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
            ) : (
                <div
                    className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${totalMatches > 0 ? "bg-green-400" : "bg-gray-300"}`}
                />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">{label}</span>{" "}
                <span>
                    &ldquo;{query}&rdquo;{matchSuffix}
                    <span className="ml-1 text-gray-400">{t("inFile", { filename })}</span>
                    {isStreaming && "..."}
                </span>
            </div>
        </div>
    );
}

function DocCreatedBlock({
    filename,
    showConnector,
    isStreaming,
    t,
}: {
    filename: string;
    showConnector?: boolean;
    isStreaming?: boolean;
    t: TFunc;
}) {
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
            ) : (
                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">
                    {isStreaming ? t("creating") : t("created")}
                </span>{" "}
                <span>{isStreaming ? `${filename}...` : filename}</span>
            </div>
        </div>
    );
}

function DocReplicatedBlock({
    filename,
    count,
    showConnector,
    isStreaming,
    hasError,
    t,
}: {
    filename: string;
    /**
     * How many consecutive replicates of this same source got collapsed
     * into this block. ≥ 1; only rendered when > 1.
     */
    count: number;
    showConnector?: boolean;
    isStreaming?: boolean;
    hasError?: boolean;
    t: TFunc;
}) {
    const label = isStreaming ? t("replicating") : t("replicated");
    const suffix =
        !isStreaming && count > 1 ? ` ${t("replicatedTimes", { count })}` : isStreaming ? "..." : "";
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
            ) : (
                <div
                    className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${hasError ? "bg-red-400" : "bg-green-400"}`}
                />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">{label}</span>{" "}
                <span>
                    {filename}
                    {suffix}
                </span>
            </div>
        </div>
    );
}

function DocDownloadBlock({
    filename,
    download_url,
    onOpen,
    isReloading = false,
    versionNumber,
}: {
    filename: string;
    download_url: string;
    onOpen?: () => void;
    isReloading?: boolean;
    versionNumber?: number | null;
}) {
    const hasVersion =
        typeof versionNumber === "number" &&
        Number.isFinite(versionNumber) &&
        versionNumber > 0;
    const extMatch = filename.match(/\.(\w+)$/);
    const ext = extMatch ? extMatch[1].toUpperCase() : "FILE";
    const rawBasename = extMatch
        ? filename.slice(0, -extMatch[0].length)
        : filename;
    // Strip any legacy "[Edited V3]" suffix that may still be baked into
    // older saved download filenames — the version is surfaced as a
    // separate tag now.
    const basename = rawBasename.replace(/\s*\[Edited V\d+\]\s*$/, "").trim();
    // Only backend-relative URLs are accepted. The download fetch carries
    // the user's bearer token, so any absolute URL from tool output is
    // refused to keep the token from leaking off-origin.
    const API_BASE =
        process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3001";
    const isSafeHref = download_url.startsWith("/");
    const href = isSafeHref ? `${API_BASE}${download_url}` : null;
    const [busy, setBusy] = useState(false);

    const handleDownload = async (e?: {
        stopPropagation?: () => void;
        preventDefault?: () => void;
    }) => {
        e?.stopPropagation?.();
        e?.preventDefault?.();
        if (busy || isReloading || !href) return;
        setBusy(true);
        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const token = session?.access_token;
            const resp = await fetch(href, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } finally {
            setBusy(false);
        }
    };

    const spinning = busy || isReloading;

    const body = (
        <div className="flex items-center gap-3 px-4 py-3 min-w-0 flex-1">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                    <p className="text-base font-serif text-gray-900 text-wrap">
                        {basename}
                    </p>
                    {hasVersion && (
                        <span className="shrink-0 inline-flex items-center rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                            V{versionNumber}
                        </span>
                    )}
                </div>
                <p className="text-xs text-blue-500 mt-0.5">{ext}</p>
            </div>
        </div>
    );

    const downloadIcon = spinning ? (
        <div
            aria-disabled
            className="shrink-0 flex items-center border-l border-gray-200 px-6 bg-white text-gray-400 cursor-not-allowed"
        >
            <Loader2 size={13} className="animate-spin" />
        </div>
    ) : (
        <button
            type="button"
            onClick={handleDownload}
            className="shrink-0 flex items-center border-l border-gray-200 px-6 bg-white text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors cursor-pointer"
        >
            <Download size={13} />
        </button>
    );

    if (onOpen) {
        return (
            <div className="flex items-stretch border border-gray-200 rounded-lg overflow-hidden w-full font-sans bg-gray-50">
                <button
                    type="button"
                    onClick={onOpen}
                    className="flex items-stretch flex-1 min-w-0 text-left hover:bg-gray-100 transition-colors cursor-pointer"
                >
                    {body}
                </button>
                {downloadIcon}
            </div>
        );
    }

    if (spinning) {
        return (
            <div className="flex items-stretch border border-gray-200 rounded-lg overflow-hidden w-full font-sans bg-gray-50">
                {body}
                {downloadIcon}
            </div>
        );
    }

    return (
        <div className="flex items-stretch border border-gray-200 rounded-lg overflow-hidden w-full font-sans bg-gray-50">
            <button
                type="button"
                onClick={handleDownload}
                className="flex items-stretch flex-1 min-w-0 text-left hover:bg-gray-100 transition-colors cursor-pointer"
            >
                {body}
            </button>
            {downloadIcon}
        </div>
    );
}

function WorkflowAppliedBlock({
    title,
    showConnector,
    onClick,
    t,
}: {
    title: string;
    showConnector?: boolean;
    onClick?: () => void;
    t: TFunc;
}) {
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            <div className="mt-2 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">{t("appliedWorkflow")}</span>{" "}
                {onClick ? (
                    <button
                        onClick={onClick}
                        className="text-left hover:text-gray-700 transition-colors cursor-pointer"
                    >
                        {title}
                    </button>
                ) : (
                    <span>{title}</span>
                )}
            </div>
        </div>
    );
}

function DocEditedBlock({
    filename,
    showConnector,
    isStreaming,
    hasError,
    t,
}: {
    filename: string;
    showConnector?: boolean;
    isStreaming?: boolean;
    hasError?: boolean;
    t: TFunc;
}) {
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
            ) : hasError ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            ) : (
                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">
                    {isStreaming
                        ? t("editing")
                        : hasError
                          ? t("editFailed")
                          : t("edited")}
                </span>{" "}
                <span>{isStreaming ? `${filename}...` : filename}</span>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Citation preprocessing
// ---------------------------------------------------------------------------

function preprocessCitations(
    text: string,
    annotations: MikeCitationAnnotation[],
    citationsList: MikeCitationAnnotation[],
): string {
    // Replace [N] or [N, M, ...] inline markers with internal §idx§ tokens backed by annotations
    return text.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (full, refsStr) => {
        const refs = (refsStr as string)
            .split(",")
            .map((s: string) => parseInt(s.trim(), 10));
        const tokens = refs.flatMap((ref: number) => {
            const ann = annotations.find((a) => a.ref === ref);
            if (!ann) return [];
            const idx = citationsList.length;
            citationsList.push(ann);
            return [`\`§${idx}§\`\u200B`];
        });
        return tokens.length > 0 ? tokens.join("") : full;
    });
}

// ---------------------------------------------------------------------------
// Markdown renderer (shared config)
// ---------------------------------------------------------------------------

function MarkdownContent({
    text,
    citationsList,
    onCitationClick,
    divRef,
}: {
    text: string;
    citationsList: MikeCitationAnnotation[];
    onCitationClick?: (c: MikeCitationAnnotation) => void;
    divRef?: React.RefObject<HTMLDivElement | null>;
}) {
    return (
        <div
            ref={divRef}
            className="text-gray-900 mb-4 text-base prose prose-sm max-w-none font-serif"
        >
            <ReactMarkdown
                remarkPlugins={[
                    [remarkMath, { singleDollarTextMath: false }],
                    remarkGfm,
                ]}
                rehypePlugins={[rehypeKatex]}
                components={{
                    table: ({ node, ...props }) => (
                        <div className="overflow-x-auto my-4">
                            <table
                                className="min-w-full divide-y divide-gray-300 border border-gray-200 rounded-lg overflow-hidden"
                                {...props}
                            />
                        </div>
                    ),
                    thead: ({ node, ...props }) => (
                        <thead className="bg-gray-50" {...props} />
                    ),
                    tbody: ({ node, ...props }) => (
                        <tbody
                            className="divide-y divide-gray-200 bg-white"
                            {...props}
                        />
                    ),
                    tr: ({ node, ...props }) => <tr {...props} />,
                    th: ({ node, ...props }) => (
                        <th
                            className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
                            {...props}
                        />
                    ),
                    td: ({ node, ...props }) => (
                        <td
                            className="whitespace-normal px-3 py-4 text-sm text-gray-900"
                            {...props}
                        />
                    ),
                    h1: ({ node, ...props }) => (
                        <h1
                            className="mt-6 mb-4 text-3xl font-serif font-semibold"
                            {...props}
                        />
                    ),
                    h2: ({ node, ...props }) => (
                        <h2
                            className="mt-5 mb-3 text-2xl font-serif font-semibold"
                            {...props}
                        />
                    ),
                    h3: ({ node, ...props }) => (
                        <h3
                            className="text-xl font-semibold mt-4 mb-2"
                            {...props}
                        />
                    ),
                    h4: ({ node, ...props }) => (
                        <h4
                            className="text-lg font-semibold mt-4 mb-2"
                            {...props}
                        />
                    ),
                    p: ({ node, ...props }) => {
                        const parent = (node as any)?.parent;
                        if (parent?.type === "listItem") {
                            return (
                                <p
                                    className="inline leading-7 m-0"
                                    {...props}
                                />
                            );
                        }
                        return <p className="mb-4 leading-7" {...props} />;
                    },
                    ul: ({ node, ...props }) => (
                        <ul
                            className="list-disc list-outside mb-4 pl-6"
                            {...props}
                        />
                    ),
                    ol: ({ node, ...props }) => (
                        <ol
                            className="list-decimal list-outside mb-4 pl-6"
                            {...props}
                        />
                    ),
                    li: ({ node, ...props }) => (
                        <li className="mb-2 leading-7" {...props} />
                    ),
                    strong: ({ node, ...props }) => (
                        <strong className="font-semibold" {...props} />
                    ),
                    em: ({ node, ...props }) => (
                        <em className="italic" {...props} />
                    ),
                    code: ({ node, children, ...props }) => {
                        const text = String(children);
                        const citMatch = text.match(/^§(\d+)§$/);
                        if (citMatch) {
                            const idx = parseInt(citMatch[1]);
                            const annotation = citationsList[idx];
                            if (annotation) {
                                const tooltipText = `${formatCitationPage(annotation)}: "${displayCitationQuote(annotation)}"`;
                                return (
                                    <button
                                        onClick={() => {
                                            console.log(
                                                "[AssistantMessage] citation clicked",
                                                annotation,
                                            );
                                            onCitationClick?.(annotation);
                                        }}
                                        className="mx-0.5 inline-flex items-center justify-center rounded-full w-4 h-4 text-[10px] font-medium transition-colors align-super bg-gray-100 text-gray-900 hover:bg-gray-200"
                                        title={tooltipText}
                                    >
                                        {idx + 1}
                                    </button>
                                );
                            }
                        }
                        return (
                            <code
                                className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-serif"
                                {...props}
                            >
                                {children}
                            </code>
                        );
                    },
                    blockquote: ({ node, ...props }) => (
                        <blockquote
                            className="border-l-4 border-gray-300 pl-4 italic my-4"
                            {...props}
                        />
                    ),
                    a: ({ node, href, children, ...props }) => (
                        <a
                            href={href}
                            className="text-blue-600 hover:text-blue-700 underline"
                            target="_blank"
                            rel="noopener noreferrer"
                            {...props}
                        >
                            {children}
                        </a>
                    ),
                    hr: ({ node, ...props }) => (
                        <hr className="my-6 border-gray-200" {...props} />
                    ),
                }}
            >
                {text}
            </ReactMarkdown>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
    content: string;
    events?: AssistantEvent[];
    isStreaming?: boolean;
    isError?: boolean;
    /** Human-readable error text rendered alongside the red Max icon. */
    errorMessage?: string;
    annotations?: MikeCitationAnnotation[];
    onCitationClick?: (citation: MikeCitationAnnotation) => void;
    minHeight?: string;
    onWorkflowClick?: (workflowId: string) => void;
    onEditViewClick?: (ann: MikeEditAnnotation, filename: string) => void;
    /**
     * Opens the editor panel for a document without auto-highlighting any
     * specific edit. Used by the download card click — opening a doc to
     * read/download shouldn't jump the viewer to the first edit.
     */
    onOpenDocument?: (args: {
        documentId: string;
        filename: string;
        versionId: string | null;
        versionNumber: number | null;
    }) => void;
    /**
     * Fires immediately when the user clicks Accept / Reject (single card
     * or the bulk "Accept all" / "Reject all"), before the backend call.
     * Parents use this to flip download cards / editor viewers into a
     * "saving" state for the duration of the round-trip.
     */
    onEditResolveStart?: (args: {
        editId: string;
        documentId: string;
        verb: "accept" | "reject";
    }) => void;
    onEditResolved?: (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => void;
    onEditError?: (args: {
        editId: string;
        documentId: string;
        versionId: string | null;
        message: string;
    }) => void;
    isDocReloading?: (documentId: string) => boolean;
    /**
     * True while an accept/reject request for this specific edit is in
     * flight. Used to disable just that edit's Accept/Reject controls
     * (sibling edits on the same doc stay clickable).
     */
    isEditReloading?: (editId: string) => boolean;
    /**
     * External override for individual edit statuses. When present, an
     * EditCard looks up its edit_id here and treats the mapped value
     * ("accepted" / "rejected") as authoritative — used so bulk-resolved
     * edits flip their per-card UI without per-card clicks.
     */
    resolvedEditStatuses?: Record<string, "accepted" | "rejected">;
    /**
     * When true, an inline Share button is rendered next to the Copy
     * button at the bottom of this message. The parent only sets this on
     * the last assistant message in the thread so we don't clutter
     * every reply with a Share affordance.
     */
    isLast?: boolean;
    onShareClick?: () => void;
    /**
     * Server-assigned chat_messages.id for the rendered assistant turn.
     * When present, the bottom toolbar shows the Print, Export PDF, and
     * Flag affordances. While the message is still streaming or has no
     * id yet (fresh assistant placeholder), those buttons stay hidden.
     */
    messageId?: string;
    /** Initial state of the "not appropriate answer" flag for this message. */
    flagged?: boolean;
    /**
     * Optional notifier — parents may want to sync the flag state into
     * their own message list (e.g. to persist it across re-renders or
     * push it into a separate analytics store).
     */
    onFlagChange?: (messageId: string, flagged: boolean) => void;
}

export function AssistantMessage({
    content: _content,
    events,
    isStreaming = false,
    isError = false,
    errorMessage,
    annotations = [],
    onCitationClick,
    minHeight = "0px",
    onWorkflowClick,
    onEditViewClick,
    onOpenDocument,
    onEditResolveStart,
    onEditResolved,
    onEditError,
    isDocReloading,
    isEditReloading,
    resolvedEditStatuses,
    isLast = false,
    onShareClick,
    messageId,
    flagged = false,
    onFlagChange,
}: Props) {
    const messageKey = useId();
    const t = useTranslations("streaming");
    const tShare = useTranslations("shareChat");
    const tCommon = useTranslations("common");
    const tActions = useTranslations("messageActions");
    const contentDivRef = useRef<HTMLDivElement | null>(null);
    const [isCopied, setIsCopied] = useState(false);
    const [isFlagged, setIsFlagged] = useState<boolean>(flagged);
    const [flagBusy, setFlagBusy] = useState(false);
    const [exporting, setExporting] = useState(false);
    // Keep local flag state in sync if the parent toggles `flagged` from
    // outside (e.g. after a refetch). We don't override mid-request so an
    // in-flight optimistic update doesn't flicker back to the old state.
    useEffect(() => {
        if (!flagBusy) setIsFlagged(flagged);
    }, [flagged, flagBusy]);
    // Per-document override of the download URL, set as Accept/Reject resolves
    // each tracked change and produces a new version.
    const [resolvedOverrides, setResolvedOverrides] = useState<
        Record<string, string>
    >({});

    const handleEditResolved = (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => {
        console.log("[AssistantMessage] handleEditResolved", args);
        if (args.downloadUrl) {
            setResolvedOverrides((prev) => ({
                ...prev,
                [args.documentId]: args.downloadUrl as string,
            }));
        }
        onEditResolved?.(args);
    };

    const status: StatusState = isError
        ? "error"
        : isStreaming
          ? "active"
          : null;

    // Pre-process citations for all content events. Each [N] marker resolves
    // to exactly one annotation (models are instructed to use shared refs
    // only for cross-page continuations via the [[PAGE_BREAK]] sentinel).
    const citationsList: MikeCitationAnnotation[] = [];
    const processedTexts: string[] = [];
    if (events) {
        for (const event of events) {
            processedTexts.push(
                event.type === "content"
                    ? preprocessCitations(
                          event.text,
                          annotations,
                          citationsList,
                      )
                    : "",
            );
        }
    }
    const handleCopy = async () => {
        try {
            let html = "";
            let plainText = "";
            if (contentDivRef.current) {
                const clone = contentDivRef.current.cloneNode(
                    true,
                ) as HTMLElement;
                html = clone.innerHTML;
                plainText = clone.textContent || "";
            }
            const item = new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([plainText], { type: "text/plain" }),
            });
            await navigator.clipboard.write([item]);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch {
            // ignore
        }
    };

    /**
     * Build a standalone, print-ready HTML document for the rendered
     * assistant answer. Wraps the rendered markdown in an Eulex-branded
     * layout (max.eulex.ai header + "Powered by Eulex.ai" footer with a
     * marketing tagline) so the resulting print/PDF carries the firm's
     * identity. Used by both Print and Export-to-PDF — the difference is
     * just whether the user picks "Print" or "Save as PDF" in the
     * system dialog the browser opens.
     */
    const buildPrintableHtml = (): string | null => {
        if (!contentDivRef.current) return null;
        const clone = contentDivRef.current.cloneNode(true) as HTMLElement;
        const innerHtml = clone.innerHTML;
        const now = new Date();
        const dateStr = now.toLocaleString();
        // Sanitise the marketing tagline so a literal closing brace in
        // CSS `content: "..."` doesn't break parsing.
        const tagline = tActions("marketingTagline").replace(/"/g, '\\"');
        return `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8" />
<title>max.eulex.ai — ${tActions("documentTitle")}</title>
<style>
  /* Print layout: reserve room at the top + bottom of every A4 page
     for our repeating margin-boxes. Chromium/WebKit honour @page margin
     boxes (top-left/right, bottom-center/right) so we don't have to fake
     repeating headers with position:fixed — which is what was causing
     the watermark and footer to overlap the body text. */
  @page {
    size: A4;
    margin: 22mm 18mm 22mm 18mm;
    @top-left {
      content: "max.eulex.ai";
      font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
      font-size: 8pt;
      letter-spacing: 1px;
      color: #94A3B8;
      text-transform: lowercase;
    }
    @top-right {
      content: "${tActions("watermark").replace(/"/g, '\\"')}";
      font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
      font-size: 7pt;
      letter-spacing: 2px;
      color: #CBD5E1;
      text-transform: uppercase;
    }
    @bottom-left {
      content: "Powered by Eulex.ai — ${tagline}";
      font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
      font-size: 8pt;
      color: #475569;
    }
    @bottom-right {
      content: "Stranica " counter(page) " / " counter(pages);
      font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
      font-size: 8pt;
      color: #94A3B8;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #111827;
    line-height: 1.6;
    font-size: 11.5pt;
  }
  /* Cover block on page 1 only — formal letterhead. */
  .doc-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    border-bottom: 1.5px solid #0F172A;
    padding-bottom: 10px;
    margin-bottom: 18px;
  }
  .doc-header .brand {
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    font-weight: 600;
    font-size: 13pt;
    letter-spacing: 0.3px;
    color: #0F172A;
  }
  .doc-header .brand .domain { color: #1D4ED8; font-weight: 700; }
  .doc-header .doc-meta {
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    font-size: 8.5pt;
    color: #64748B;
    text-align: right;
    line-height: 1.4;
  }
  .doc-meta .label { text-transform: uppercase; letter-spacing: 1.5px; font-size: 7.5pt; color: #94A3B8; }

  h1, h2, h3, h4 {
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #0F172A;
    page-break-after: avoid;
    break-after: avoid;
  }
  h1 { font-size: 20pt; margin: 18px 0 10px; line-height: 1.25; }
  h2 { font-size: 15pt; margin: 18px 0 8px; line-height: 1.3; }
  h3 { font-size: 12.5pt; margin: 14px 0 6px; line-height: 1.35; }
  h4 { font-size: 11.5pt; margin: 12px 0 6px; font-weight: 600; }
  p  { margin: 0 0 9px; orphans: 3; widows: 3; }
  ul, ol { margin: 4px 0 12px 22px; padding: 0; }
  li { margin-bottom: 4px; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  th, td {
    border: 1px solid #E2E8F0;
    padding: 7px 9px;
    text-align: left;
    font-size: 10.5pt;
    vertical-align: top;
  }
  th { background: #F8FAFC; font-family: 'Inter', sans-serif; font-weight: 600; }
  blockquote {
    border-left: 3px solid #CBD5E1;
    padding-left: 12px;
    color: #475569;
    margin: 10px 0;
    font-style: italic;
  }
  code { background: #F1F5F9; padding: 1px 4px; border-radius: 3px; font-size: 10.5pt; }
  pre  {
    background: #F1F5F9;
    padding: 10px;
    border-radius: 4px;
    overflow: auto;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  a { color: #1D4ED8; text-decoration: underline; }

  /* Strip any rendered inline UI controls Max embeds in the live answer
     (citation pills, etc.) — they shouldn't reach the printout. */
  button { display: none !important; }

  /* Closing card with the disclaimer. Tries to stay on the same page as
     the last paragraph, but allows a break before if there isn't room. */
  .doc-disclaimer {
    margin-top: 24px;
    padding-top: 10px;
    border-top: 1px solid #E2E8F0;
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    font-size: 8.5pt;
    color: #64748B;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .doc-disclaimer .powered {
    display: block;
    color: #0F172A;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .doc-disclaimer .powered .accent { color: #1D4ED8; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <header class="doc-header">
    <div class="brand">
      <span class="domain">max.eulex.ai</span> &middot; ${tActions("brandLabel")}
    </div>
    <div class="doc-meta">
      <div class="label">${tActions("generatedOn")}</div>
      <div>${dateStr}</div>
    </div>
  </header>
  <main class="doc-content prose">
    ${innerHtml}
  </main>
  <footer class="doc-disclaimer">
    <span class="powered">Powered by <span class="accent">Eulex.ai</span> — ${tActions("marketingTagline")}</span>
    ${tActions("disclaimer")}
  </footer>
</body>
</html>`;
    };

    /**
     * Opens a hidden iframe containing the branded answer and triggers
     * the browser's print dialog. From there the user can pick "Save as
     * PDF" (Export) or any installed printer (Print). Using an iframe
     * instead of window.print() on the current page keeps the surrounding
     * Max UI out of the printout.
     *
     * The spinner is cleared as soon as the print dialog opens (or 1.5s
     * after, whichever comes first) — the modal print dialog blocks the
     * UI anyway, so a perpetual spinner just confuses users into thinking
     * the export is still in progress.
     */
    const openPrintWindow = (action: "print" | "pdf") => {
        const html = buildPrintableHtml();
        if (!html) return;
        if (action === "pdf") setExporting(true);
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "0";
        iframe.style.visibility = "hidden";
        document.body.appendChild(iframe);

        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            try {
                document.body.removeChild(iframe);
            } catch {
                /* ignore */
            }
            if (action === "pdf") setExporting(false);
        };
        // Spinner only signals "preparing the print preview" — once the
        // browser shows the print dialog the UI is blocked, so clearing
        // the spinner shortly after triggering keeps the toolbar honest.
        const clearSpinnerSoon = () => {
            if (action === "pdf") setExporting(false);
        };

        try {
            const doc =
                iframe.contentDocument ?? iframe.contentWindow?.document;
            if (!doc) {
                cleanup();
                return;
            }
            doc.open();
            doc.write(html);
            doc.close();

            const win = iframe.contentWindow;
            const triggerPrint = () => {
                try {
                    win?.focus();
                    win?.print();
                } catch (err) {
                    console.error(
                        "[AssistantMessage] iframe.print() failed",
                        err,
                    );
                }
                // The print dialog is open (or was dismissed instantly
                // by an extension); either way the user no longer needs
                // a spinner.
                clearSpinnerSoon();
            };

            // `afterprint` fires when the user dismisses the dialog
            // (Save / Cancel). At that point the iframe has served its
            // purpose — drop it from the DOM.
            win?.addEventListener("afterprint", () => {
                setTimeout(cleanup, 100);
            });

            // Wait for the iframe's load event before printing so
            // fonts/images render. Fall back to a short delay if `load`
            // never fires (some browsers skip it for doc.write streams).
            let printed = false;
            const printOnce = () => {
                if (printed) return;
                printed = true;
                triggerPrint();
            };
            win?.addEventListener("load", printOnce);
            setTimeout(printOnce, 350);

            // Safety net — if the user never closes the print dialog
            // (or `afterprint` is suppressed by the browser), drop the
            // iframe + spinner after a generous window so we don't leak.
            setTimeout(() => {
                clearSpinnerSoon();
                cleanup();
            }, 60_000);
        } catch (err) {
            console.error("[AssistantMessage] print failed", err);
            cleanup();
        }
    };

    const handlePrint = () => openPrintWindow("print");
    const handleExportPdf = () => openPrintWindow("pdf");

    const handleToggleFlag = async () => {
        if (!messageId || flagBusy) return;
        const next = !isFlagged;
        setFlagBusy(true);
        setIsFlagged(next);
        try {
            const resp = await setMessageFlag(messageId, next);
            const persisted = !!resp.is_flagged;
            setIsFlagged(persisted);
            onFlagChange?.(messageId, persisted);
        } catch (err) {
            console.error("[AssistantMessage] flag toggle failed", err);
            setIsFlagged(!next);
        } finally {
            setFlagBusy(false);
        }
    };

    const lastContentIdx = events
        ? events.reduce(
              (last, e, idx) => (e.type === "content" ? idx : last),
              -1,
          )
        : -1;

    // Walk events in chronological order and group consecutive non-content
    // events into their own PreResponseWrapper. Content events render
    // between wrappers, so reasoning/tool chatter that arrives after the
    // model has already streamed some prose gets its own wrapper.
    type EventGroup =
        | { kind: "pre"; events: AssistantEvent[]; indices: number[] }
        | {
              kind: "content";
              event: Extract<AssistantEvent, { type: "content" }>;
              index: number;
          };

    const groups: EventGroup[] = [];
    if (events) {
        let current: Extract<EventGroup, { kind: "pre" }> | null = null;
        events.forEach((e, i) => {
            if (e.type === "content") {
                if (current) {
                    groups.push(current);
                    current = null;
                }
                groups.push({ kind: "content", event: e, index: i });
            } else {
                if (!current)
                    current = { kind: "pre", events: [], indices: [] };
                current.events.push(e);
                current.indices.push(i);
            }
        });
        if (current) groups.push(current);
    }

    const hasContentAfter = (groupIdx: number): boolean => {
        for (let i = groupIdx + 1; i < groups.length; i++) {
            const g = groups[i];
            if (g.kind === "content" && g.event.text.length > 0) return true;
        }
        return false;
    };

    const renderEvent = (
        event: AssistantEvent,
        i: number,
        allEvents: AssistantEvent[],
        globalIdx: number,
    ) => {
        const nextEvent = allEvents[i + 1];
        const showConnector =
            nextEvent !== undefined && nextEvent.type !== "content";

        if (event.type === "content") {
            const isLastContent = globalIdx === lastContentIdx;
            const processed = processedTexts[globalIdx];
            return (
                <div key={globalIdx}>
                    <MarkdownContent
                        text={processed}
                        citationsList={citationsList}
                        onCitationClick={onCitationClick}
                        divRef={isLastContent ? contentDivRef : undefined}
                    />
                </div>
            );
        }
        if (event.type === "reasoning") {
            return (
                <ReasoningBlock
                    key={globalIdx}
                    text={event.text}
                    isStreaming={!!event.isStreaming}
                    showConnector={showConnector}
                    t={t}
                />
            );
        }
        if (event.type === "tool_call_start") {
            return (
                <div
                    key={globalIdx}
                    className="flex items-center text-sm font-serif text-gray-500 relative"
                >
                    {showConnector && (
                        <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
                    )}
                    <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                    <span className="font-medium ml-2">{t("running")}</span>
                    <span className="ml-1">
                        {event.display_name
                            ? `${event.display_name}...`
                            : event.name
                              ? `${event.name}...`
                              : `${t("tool")}...`}
                    </span>
                </div>
            );
        }
        if (event.type === "thinking") {
            return (
                <div
                    key={globalIdx}
                    className="flex items-center text-sm font-serif text-gray-500 relative"
                >
                    {showConnector && (
                        <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
                    )}
                    <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                    <span className="ml-2">{t("thinking")}</span>
                </div>
            );
        }
        if (
            event.type === "web_search_started" ||
            event.type === "web_search_result"
        ) {
            const isStreaming = event.type === "web_search_started";
            const results =
                event.type === "web_search_result" ? event.results : [];
            const error =
                event.type === "web_search_result" ? event.error : null;
            return (
                <WebSearchBlock
                    key={globalIdx}
                    query={event.query}
                    provider={event.provider}
                    results={results}
                    error={error}
                    isStreaming={isStreaming}
                    showConnector={showConnector}
                    t={t}
                />
            );
        }
        if (event.type === "doc_read") {
            const ann = annotations.find((a) => a.filename === event.filename);
            return (
                <DocReadBlock
                    key={globalIdx}
                    filename={event.filename}
                    isStreaming={event.isStreaming}
                    onClick={
                        !event.isStreaming && ann && onCitationClick
                            ? () => onCitationClick(ann)
                            : undefined
                    }
                    showConnector={showConnector}
                    t={t}
                />
            );
        }
        if (event.type === "doc_find") {
            return (
                <DocFindBlock
                    key={globalIdx}
                    filename={event.filename}
                    query={event.query}
                    totalMatches={event.total_matches}
                    isStreaming={!!event.isStreaming}
                    showConnector={showConnector}
                    t={t}
                />
            );
        }
        if (event.type === "doc_created") {
            return (
                <DocCreatedBlock
                    key={globalIdx}
                    filename={event.filename}
                    isStreaming={event.isStreaming}
                    showConnector={showConnector}
                    t={t}
                />
            );
        }
        if (event.type === "doc_replicated") {
            // The backend now does N copies in one tool call and reports
            // count + copies on a single event, so no consecutive-event
            // aggregation needed.
            return (
                <DocReplicatedBlock
                    key={globalIdx}
                    filename={event.filename}
                    count={event.count}
                    isStreaming={!!event.isStreaming}
                    hasError={!!event.error}
                    showConnector={showConnector}
                    t={t}
                />
            );
        }
        if (event.type === "doc_edited") {
            return (
                <DocEditedBlock
                    key={globalIdx}
                    filename={event.filename}
                    isStreaming={event.isStreaming}
                    hasError={!!event.error}
                    showConnector={showConnector}
                    t={t}
                />
            );
        }
        if (event.type === "workflow_applied") {
            return (
                <WorkflowAppliedBlock
                    key={globalIdx}
                    title={event.title}
                    showConnector={showConnector}
                    onClick={
                        onWorkflowClick
                            ? () => onWorkflowClick(event.workflow_id)
                            : undefined
                    }
                    t={t}
                />
            );
        }
        if (event.type === "mcp_tool_result") {
            return (
                <McpToolResultBlock
                    key={globalIdx}
                    server={event.server}
                    tool={event.tool}
                    ok={event.ok}
                    args={event.args}
                    output={event.output}
                    showConnector={showConnector}
                    t={t}
                />
            );
        }
        return null;
    };

    return (
        <div style={{ minHeight }}>
            <ResponseStatus status={status} />
            <div className="w-full font-inter relative mt-2">
                {events && events.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        {groups.map((g, gIdx) => {
                            if (g.kind === "content") {
                                const isLastContent =
                                    g.index === lastContentIdx;
                                return (
                                    <div key={`c-${g.index}`}>
                                        <MarkdownContent
                                            text={processedTexts[g.index]}
                                            citationsList={citationsList}
                                            onCitationClick={onCitationClick}
                                            divRef={
                                                isLastContent
                                                    ? contentDivRef
                                                    : undefined
                                            }
                                        />
                                    </div>
                                );
                            }
                            const subsequentContent = hasContentAfter(gIdx);
                            const wrapperIsStreaming = g.events.some(
                                (event) =>
                                    "isStreaming" in event &&
                                    !!event.isStreaming,
                            );
                            return (
                                <PreResponseWrapper
                                    key={`p-${g.indices[0]}`}
                                    stepCount={g.events.length}
                                    shouldMinimize={subsequentContent}
                                    isStreaming={wrapperIsStreaming}
                                >
                                    {g.events.map((event, i) =>
                                        renderEvent(
                                            event,
                                            i,
                                            g.events,
                                            g.indices[i],
                                        ),
                                    )}
                                </PreResponseWrapper>
                            );
                        })}
                        {/* Bulk accept/reject + per-edit cards — below the
                            response content, only after streaming stops,
                            rendered above the download card. */}
                        {!isStreaming &&
                            (() => {
                                const editedEvents = events.filter(
                                    (e) =>
                                        e.type === "doc_edited" &&
                                        !e.isStreaming,
                                ) as Extract<
                                    AssistantEvent,
                                    { type: "doc_edited" }
                                >[];
                                const pending: {
                                    annotation: MikeEditAnnotation;
                                    filename: string;
                                }[] = [];
                                const filenameByDocId = new Map<
                                    string,
                                    string
                                >();
                                // Effective status = external override if any, else the annotation's DB status.
                                const statusOf = (ann: MikeEditAnnotation) =>
                                    resolvedEditStatuses?.[ann.edit_id] ??
                                    ann.status;
                                for (const e of editedEvents) {
                                    filenameByDocId.set(
                                        e.document_id,
                                        e.filename,
                                    );
                                    for (const ann of e.annotations) {
                                        if (statusOf(ann) === "pending") {
                                            pending.push({
                                                annotation: ann,
                                                filename: e.filename,
                                            });
                                        }
                                    }
                                }
                                const cards = editedEvents.flatMap((e) =>
                                    e.annotations.map((ann) => (
                                        <EditCard
                                            key={`editcard-${ann.edit_id}`}
                                            annotation={ann}
                                            resolvedStatus={
                                                resolvedEditStatuses?.[
                                                    ann.edit_id
                                                ]
                                            }
                                            isReloading={
                                                isEditReloading?.(
                                                    ann.edit_id,
                                                ) ?? false
                                            }
                                            onViewClick={(a) =>
                                                onEditViewClick?.(a, e.filename)
                                            }
                                            onResolveStart={onEditResolveStart}
                                            onResolved={handleEditResolved}
                                            onError={onEditError}
                                        />
                                    )),
                                );
                                const resolvedCount = editedEvents.reduce(
                                    (acc, e) =>
                                        acc +
                                        e.annotations.filter(
                                            (a) => statusOf(a) !== "pending",
                                        ).length,
                                    0,
                                );
                                // If there's only one edit total, skip the
                                // minimisable wrapper / bulk-actions UI and
                                // render the bare EditCard — no value in
                                // bulk controls for a single item.
                                if (cards.length <= 1) {
                                    return cards;
                                }
                                return (
                                    <EditCardsSection
                                        pending={pending}
                                        filenameByDocId={filenameByDocId}
                                        cards={cards}
                                        resolvedCount={resolvedCount}
                                        onViewClick={onEditViewClick}
                                        onResolveStart={onEditResolveStart}
                                        onResolved={handleEditResolved}
                                        onError={onEditError}
                                        t={t}
                                    />
                                );
                            })()}
                    </div>
                ) : null}

                {isError && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-serif text-red-700">
                        <span className="leading-snug">
                            {errorMessage ?? "Sorry, something went wrong."}
                        </span>
                    </div>
                )}

                {/* Download card for each edited doc — only after streaming
                    stops, and deduped per document (keep the latest edit). */}
                {events &&
                    !isStreaming &&
                    (() => {
                        const edited = events.filter(
                            (
                                e,
                            ): e is Extract<
                                AssistantEvent,
                                { type: "doc_edited" }
                            > =>
                                e.type === "doc_edited" &&
                                !e.isStreaming &&
                                !!e.download_url,
                        );
                        const latestByDoc = new Map<
                            string,
                            (typeof edited)[number]
                        >();
                        for (const e of edited)
                            latestByDoc.set(e.document_id, e);
                        return Array.from(latestByDoc.values()).map((e) => (
                            <div
                                key={`edited-download-${e.document_id}`}
                                className="flex flex-col gap-2 mt-2 mb-3"
                            >
                                <DocDownloadBlock
                                    filename={e.filename}
                                    download_url={
                                        resolvedOverrides[e.document_id] ??
                                        e.download_url
                                    }
                                    versionNumber={e.version_number ?? null}
                                    onOpen={
                                        onOpenDocument
                                            ? () =>
                                                  onOpenDocument({
                                                      documentId: e.document_id,
                                                      filename: e.filename,
                                                      versionId:
                                                          e.version_id ?? null,
                                                      versionNumber:
                                                          e.version_number ??
                                                          null,
                                                  })
                                            : onEditViewClick &&
                                                e.annotations[0]
                                              ? () =>
                                                    onEditViewClick(
                                                        e.annotations[0],
                                                        e.filename,
                                                    )
                                              : undefined
                                    }
                                    isReloading={
                                        isDocReloading?.(e.document_id) ?? false
                                    }
                                />
                            </div>
                        ));
                    })()}

                {/* Download cards for created docs — generated docs now
                    persist as first-class documents, so clicking opens
                    them in the DocPanel (like edited docs). */}
                {events &&
                    !isStreaming &&
                    events.some(
                        (e) => e.type === "doc_created" && e.download_url,
                    ) && (
                        <div className="flex flex-col gap-2 mt-2 mb-3">
                            {(
                                events.filter(
                                    (e) =>
                                        e.type === "doc_created" &&
                                        e.download_url,
                                ) as Extract<
                                    AssistantEvent,
                                    { type: "doc_created" }
                                >[]
                            ).map((e, i) => {
                                const documentId = e.document_id;
                                const versionId = e.version_id ?? null;
                                const versionNumber = e.version_number ?? null;
                                const canOpen =
                                    !!onOpenDocument && !!documentId;
                                return (
                                    <DocDownloadBlock
                                        key={i}
                                        filename={e.filename}
                                        download_url={e.download_url}
                                        versionNumber={versionNumber}
                                        onOpen={
                                            canOpen
                                                ? () =>
                                                      onOpenDocument!({
                                                          documentId:
                                                              documentId!,
                                                          filename: e.filename,
                                                          versionId,
                                                          versionNumber,
                                                      })
                                                : undefined
                                        }
                                    />
                                );
                            })}
                        </div>
                    )}

                {/* Toolbar — Copy / Print / Export PDF / Flag / Share.
                    Print + Export PDF render the assistant answer through
                    a hidden iframe with the max.eulex.ai branded layout;
                    Flag toggles chat_messages.is_flagged via the API. The
                    Share button still appears only on the last assistant
                    reply so the affordance is consistently anchored. */}
                <div className="flex items-center gap-1 pt-2 pb-4 md:pb-8 font-sans justify-start">
                    {!isStreaming && (
                        <button
                            className="p-1.5 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                            onClick={handleCopy}
                            title={
                                isCopied
                                    ? tCommon("copied")
                                    : tCommon("copy")
                            }
                            aria-label={tCommon("copy")}
                        >
                            {isCopied ? (
                                <Check className="h-3.5 w-3.5 text-green-600" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                        </button>
                    )}
                    {!isStreaming && (
                        <button
                            className="p-1.5 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                            onClick={handlePrint}
                            title={tActions("print")}
                            aria-label={tActions("print")}
                        >
                            <Printer className="h-3.5 w-3.5" />
                        </button>
                    )}
                    {!isStreaming && (
                        <button
                            className="p-1.5 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                            onClick={handleExportPdf}
                            disabled={exporting}
                            title={tActions("exportPdf")}
                            aria-label={tActions("exportPdf")}
                        >
                            {exporting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <FileDown className="h-3.5 w-3.5" />
                            )}
                        </button>
                    )}
                    {!isStreaming && messageId && (
                        <button
                            className={`p-1.5 rounded transition-colors disabled:opacity-50 ${
                                isFlagged
                                    ? "text-red-600 hover:bg-red-50"
                                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                            }`}
                            onClick={handleToggleFlag}
                            disabled={flagBusy}
                            title={tActions("flagTooltip")}
                            aria-label={tActions("flagTooltip")}
                            aria-pressed={isFlagged}
                        >
                            {flagBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Flag
                                    className="h-3.5 w-3.5"
                                    fill={isFlagged ? "currentColor" : "none"}
                                />
                            )}
                        </button>
                    )}
                    {!isStreaming && isLast && onShareClick && (
                        <button
                            className="p-1.5 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                            onClick={onShareClick}
                            title={tShare("title")}
                            aria-label={tShare("title")}
                        >
                            <Share2 className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
