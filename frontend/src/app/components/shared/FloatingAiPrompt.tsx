"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import type { ColumnConfig, ColumnFormat } from "@/app/components/shared/types";
import {
    refineWorkflowWithAi,
    suggestTabularColumnsWithAi,
    updateTabularReview,
    updateWorkflow,
} from "@/app/lib/mikeApi";

const VALID_FORMATS: ColumnFormat[] = [
    "text",
    "bulleted_list",
    "number",
    "percentage",
    "monetary_amount",
    "currency",
    "yes_no",
    "date",
    "tag",
];

function normalizeFormat(raw: string | undefined): ColumnFormat {
    const v = (raw ?? "text").toLowerCase().trim();
    return VALID_FORMATS.includes(v as ColumnFormat)
        ? (v as ColumnFormat)
        : "text";
}

type WorkflowProps = {
    variant: "workflow";
    workflowId: string;
    onApplied: (next: {
        title: string;
        prompt_md: string;
        columns: ColumnConfig[];
    }) => void;
};

type TabularProps = {
    variant: "tabular";
    reviewId: string;
    columns: ColumnConfig[];
    onApplied: (next: ColumnConfig[]) => void;
};

type Props = WorkflowProps | TabularProps;

const TEXTAREA_MAX_PX = 140;

export function FloatingAiPrompt(props: Props) {
    const t = useTranslations("floatingAi");
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const el = taRef.current;
        if (!el) return;
        el.style.height = "0px";
        el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_PX)}px`;
    }, [text]);

    async function handleSubmit() {
        const instruction = text.trim();
        if (!instruction || busy) return;
        setBusy(true);
        setErr(null);
        try {
            if (props.variant === "workflow") {
                const out = await refineWorkflowWithAi(
                    props.workflowId,
                    instruction,
                );
                const rawCols = (out.columns_config ?? []) as Record<
                    string,
                    unknown
                >[];
                const columns: ColumnConfig[] = rawCols.map((c, i) => ({
                    index: i,
                    name: String(c.name ?? ""),
                    prompt: String(c.prompt ?? ""),
                    format: normalizeFormat(String(c.format ?? "text")),
                    tags: Array.isArray(c.tags)
                        ? c.tags.filter((x) => typeof x === "string")
                        : undefined,
                }));
                await updateWorkflow(props.workflowId, {
                    title: out.title,
                    prompt_md: out.prompt_md,
                    columns_config: columns,
                });
                props.onApplied({
                    title: out.title,
                    prompt_md: out.prompt_md,
                    columns,
                });
            } else {
                const out = await suggestTabularColumnsWithAi(
                    props.reviewId,
                    instruction,
                    props.columns,
                );
                const start = props.columns.length;
                const added: ColumnConfig[] = out.columns.map((c, i) => ({
                    index: start + i,
                    name: c.name,
                    prompt: c.prompt,
                    format: normalizeFormat(c.format),
                    tags: c.tags,
                }));
                const merged = [...props.columns, ...added].map((c, i) => ({
                    ...c,
                    index: i,
                }));
                await updateTabularReview(props.reviewId, {
                    columns_config: merged,
                });
                props.onApplied(merged);
            }
            setText("");
        } catch {
            setErr(t("error"));
        } finally {
            setBusy(false);
        }
    }

    const isWorkflow = props.variant === "workflow";
    const placeholder = isWorkflow
        ? t("workflowPlaceholder")
        : t("tabularPlaceholder");
    const sendLabel = isWorkflow ? t("workflowSubmit") : t("tabularSubmit");

    return (
        <div
            className="fixed z-[90] bottom-6 left-1/2 -translate-x-1/2 w-[min(820px,calc(100vw-3rem))]"
            style={{ pointerEvents: "none" }}
        >
            <div
                className="rounded-full border border-gray-200 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.07)] flex items-center gap-3 pl-5 pr-1.5 py-1.5 focus-within:border-gray-900 focus-within:shadow-[0_4px_28px_rgba(0,0,0,0.10)] transition-colors"
                style={{ pointerEvents: "auto" }}
            >
                <Sparkles className="h-4 w-4 text-gray-700 shrink-0" />
                <textarea
                    ref={taRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void handleSubmit();
                        }
                    }}
                    placeholder={placeholder}
                    rows={1}
                    disabled={busy}
                    aria-label={sendLabel}
                    className="flex-1 resize-none bg-transparent border-none outline-none text-sm text-gray-800 placeholder:text-gray-400 py-2 leading-5 max-h-[160px] overflow-y-auto"
                />
                <button
                    type="button"
                    disabled={busy || !text.trim()}
                    onClick={() => void handleSubmit()}
                    title={sendLabel}
                    aria-label={sendLabel}
                    className="flex items-center justify-center h-9 w-9 rounded-full bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                    {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <ArrowUp className="h-4 w-4" />
                    )}
                </button>
            </div>
            {err && (
                <p
                    className="mt-2 text-xs text-red-600 text-center"
                    style={{ pointerEvents: "auto" }}
                >
                    {err}
                </p>
            )}
        </div>
    );
}
