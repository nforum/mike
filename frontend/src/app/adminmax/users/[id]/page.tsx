"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    AdminUnauthorizedError,
    getAdminToken,
    getUser,
    listMessages,
    listUsage,
    triggerCsvDownload,
    type AdminMessageRow,
    type AdminUsageRow,
    type AdminUserDetailResponse,
} from "../../lib/adminApi";

const PAGE_SIZE = 50;

function fmtUsd(n: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
    }).format(n);
}

function fmtInt(n: number): string {
    return new Intl.NumberFormat("hr-HR").format(n);
}

function fmtDate(s: string | null): string {
    if (!s) return "—";
    try {
        return new Date(s).toLocaleString("hr-HR", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    } catch {
        return s;
    }
}

function defaultRange(): { from: string; to: string } {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const toLocal = (d: Date) =>
        new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
            .toISOString()
            .slice(0, 16);
    return { from: toLocal(from), to: toLocal(to) };
}

function localToIso(local: string): string {
    return new Date(local).toISOString();
}

/**
 * Best-effort plain-text rendering of an assistant message stored as
 * an AssistantEvent[] array in chat_messages.content. We only extract
 * `text` / `content` fields from `content` and `reasoning` events so
 * the admin sees something readable without rendering markdown.
 */
function summarizeContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return JSON.stringify(content);
    const parts: string[] = [];
    for (const ev of content as Record<string, unknown>[]) {
        if (typeof ev?.text === "string") parts.push(String(ev.text));
        else if (typeof ev?.content === "string")
            parts.push(String(ev.content));
        else if (ev?.type === "tool_call_start" && typeof ev.name === "string")
            parts.push(`⧗ ${ev.name}`);
        else if (ev?.type === "doc_created" && typeof ev.filename === "string")
            parts.push(`📄 ${ev.filename}`);
    }
    return parts.join("\n");
}

export default function AdminMaxUserDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id: userId } = use(params);
    const router = useRouter();
    const [range, setRange] = useState(defaultRange);
    const [tab, setTab] = useState<"usage" | "messages">("usage");
    const [detail, setDetail] = useState<AdminUserDetailResponse | null>(null);
    const [usagePage, setUsagePage] = useState(0);
    const [usage, setUsage] = useState<AdminUsageRow[]>([]);
    const [usageTotal, setUsageTotal] = useState(0);
    const [msgPage, setMsgPage] = useState(0);
    const [messages, setMessages] = useState<AdminMessageRow[]>([]);
    const [messagesTotal, setMessagesTotal] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        if (!getAdminToken()) router.replace("/adminmax/login");
    }, [router]);

    async function load() {
        setLoading(true);
        setError(null);
        const fromIso = localToIso(range.from);
        const toIso = localToIso(range.to);
        try {
            const [d, u, m] = await Promise.all([
                getUser(userId, { from: fromIso, to: toIso }),
                listUsage(userId, {
                    from: fromIso,
                    to: toIso,
                    limit: PAGE_SIZE,
                    offset: usagePage * PAGE_SIZE,
                }),
                listMessages(userId, {
                    from: fromIso,
                    to: toIso,
                    limit: PAGE_SIZE,
                    offset: msgPage * PAGE_SIZE,
                }),
            ]);
            setDetail(d);
            setUsage(u.rows);
            setUsageTotal(u.total);
            setMessages(m.rows);
            setMessagesTotal(m.total);
        } catch (err) {
            if (err instanceof AdminUnauthorizedError) {
                router.replace("/adminmax/login");
                return;
            }
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!getAdminToken()) return;
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [usagePage, msgPage]);

    async function exportUserCsv() {
        setExporting(true);
        try {
            const params = new URLSearchParams({
                from: localToIso(range.from),
                to: localToIso(range.to),
            });
            const fname = `adminmax_usage_${userId}_${range.from.slice(0, 10)}_${range.to.slice(0, 10)}.csv`;
            await triggerCsvDownload(
                `/users/${userId}/usage.csv?${params.toString()}`,
                fname,
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setExporting(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-end justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                    <Link
                        href="/adminmax"
                        className="text-xs text-slate-500 hover:text-slate-200"
                    >
                        ← Natrag na popis
                    </Link>
                    <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight">
                        {detail?.user.email ?? userId}
                    </h1>
                    {detail?.user.display_name && (
                        <p className="text-sm text-slate-400">
                            {detail.user.display_name}
                        </p>
                    )}
                </div>
                <div className="flex items-end gap-3">
                    <label className="block text-xs">
                        <span className="mb-1 block uppercase tracking-wide text-slate-400">
                            Od
                        </span>
                        <input
                            type="datetime-local"
                            value={range.from}
                            onChange={(e) =>
                                setRange((r) => ({ ...r, from: e.target.value }))
                            }
                            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                        />
                    </label>
                    <label className="block text-xs">
                        <span className="mb-1 block uppercase tracking-wide text-slate-400">
                            Do
                        </span>
                        <input
                            type="datetime-local"
                            value={range.to}
                            onChange={(e) =>
                                setRange((r) => ({ ...r, to: e.target.value }))
                            }
                            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                        />
                    </label>
                    <button
                        onClick={() => {
                            setUsagePage(0);
                            setMsgPage(0);
                            load();
                        }}
                        disabled={loading}
                        className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-50"
                    >
                        {loading ? "Učitavam…" : "Osvježi"}
                    </button>
                    <button
                        onClick={exportUserCsv}
                        disabled={exporting}
                        className="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                        {exporting ? "Export…" : "CSV (korisnik)"}
                    </button>
                </div>
            </div>

            {error && (
                <div className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                    {error}
                </div>
            )}

            {detail && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <SummaryCard
                        label="Trošak"
                        value={fmtUsd(detail.totals.cost_usd_total)}
                    />
                    <SummaryCard
                        label="Zahtjevi"
                        value={fmtInt(detail.totals.request_count)}
                        subValue={`Greške: ${detail.totals.error_count}`}
                    />
                    <SummaryCard
                        label="Input"
                        value={fmtInt(detail.totals.input_tokens_total)}
                    />
                    <SummaryCard
                        label="Output"
                        value={fmtInt(detail.totals.output_tokens_total)}
                    />
                    <SummaryCard
                        label="Cache R / W"
                        value={fmtInt(detail.totals.cache_read_input_tokens_total)}
                        subValue={`W: ${fmtInt(detail.totals.cache_creation_input_tokens_total)}`}
                    />
                </div>
            )}

            <div className="flex gap-2 border-b border-slate-800">
                <TabButton
                    active={tab === "usage"}
                    onClick={() => setTab("usage")}
                >
                    Zapisi potrošnje ({fmtInt(usageTotal)})
                </TabButton>
                <TabButton
                    active={tab === "messages"}
                    onClick={() => setTab("messages")}
                >
                    Poruke ({fmtInt(messagesTotal)})
                </TabButton>
            </div>

            {tab === "usage" ? (
                <UsageTable
                    rows={usage}
                    page={usagePage}
                    total={usageTotal}
                    onPage={setUsagePage}
                />
            ) : (
                <MessagesList
                    rows={messages}
                    page={msgPage}
                    total={messagesTotal}
                    onPage={setMsgPage}
                />
            )}
        </div>
    );
}

function SummaryCard({
    label,
    value,
    subValue,
}: {
    label: string;
    value: string;
    subValue?: string;
}) {
    return (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-400">
                {label}
            </div>
            <div className="mt-1 font-mono text-lg text-slate-100">{value}</div>
            {subValue && (
                <div className="mt-0.5 font-mono text-xs text-slate-500">
                    {subValue}
                </div>
            )}
        </div>
    );
}

function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                active
                    ? "border-slate-100 text-slate-100"
                    : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
        >
            {children}
        </button>
    );
}

function UsageTable({
    rows,
    page,
    total,
    onPage,
}: {
    rows: AdminUsageRow[];
    page: number;
    total: number;
    onPage: (p: number) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return (
        <div className="space-y-3">
            <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                    <thead className="bg-slate-900/60 text-slate-400">
                        <tr>
                            <Th>Vrijeme</Th>
                            <Th>Model</Th>
                            <Th align="right">Iter</Th>
                            <Th align="right">Input</Th>
                            <Th align="right">Output</Th>
                            <Th align="right">Cache R / W</Th>
                            <Th align="right">USD</Th>
                            <Th align="right">Trajanje</Th>
                            <Th>Status</Th>
                            <Th>Chat</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr>
                                <td
                                    colSpan={10}
                                    className="px-4 py-6 text-center text-slate-500"
                                >
                                    Nema zapisa u rasponu.
                                </td>
                            </tr>
                        )}
                        {rows.map((r) => (
                            <tr
                                key={r.id}
                                className={`border-t border-slate-800 ${
                                    r.status === "error"
                                        ? "bg-red-950/20"
                                        : "hover:bg-slate-900/40"
                                }`}
                            >
                                <Td className="text-xs text-slate-300">
                                    {fmtDate(r.created_at)}
                                </Td>
                                <Td className="font-mono text-xs">{r.model}</Td>
                                <Td align="right" className="font-mono text-xs">
                                    {r.iterations}
                                </Td>
                                <Td align="right" className="font-mono text-xs">
                                    {fmtInt(r.input_tokens)}
                                </Td>
                                <Td align="right" className="font-mono text-xs">
                                    {fmtInt(r.output_tokens)}
                                </Td>
                                <Td align="right" className="font-mono text-xs">
                                    {fmtInt(r.cache_read_input_tokens)} /{" "}
                                    {fmtInt(r.cache_creation_input_tokens)}
                                </Td>
                                <Td align="right" className="font-mono">
                                    {fmtUsd(Number(r.cost_usd))}
                                </Td>
                                <Td align="right" className="font-mono text-xs">
                                    {r.duration_ms != null
                                        ? `${(r.duration_ms / 1000).toFixed(1)}s`
                                        : "—"}
                                </Td>
                                <Td>
                                    {r.status === "ok" ? (
                                        <span className="text-xs text-emerald-400">
                                            ok
                                        </span>
                                    ) : (
                                        <span
                                            className="text-xs text-red-400"
                                            title={r.error_message ?? ""}
                                        >
                                            {r.status}
                                        </span>
                                    )}
                                </Td>
                                <Td className="font-mono text-xs text-slate-500">
                                    {r.chat_id?.slice(0, 8) ?? "—"}
                                </Td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pagination page={page} totalPages={totalPages} onPage={onPage} />
        </div>
    );
}

function MessagesList({
    rows,
    page,
    total,
    onPage,
}: {
    rows: AdminMessageRow[];
    page: number;
    total: number;
    onPage: (p: number) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return (
        <div className="space-y-3">
            <ul className="space-y-3">
                {rows.length === 0 && (
                    <li className="rounded-md border border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
                        Nema poruka u rasponu.
                    </li>
                )}
                {rows.map((m) => {
                    const text = summarizeContent(m.content);
                    const truncated =
                        text.length > 1500 ? text.slice(0, 1500) + "…" : text;
                    return (
                        <li
                            key={m.id}
                            className="rounded-md border border-slate-800 bg-slate-900/40 px-4 py-3"
                        >
                            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-400">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                                            m.role === "assistant"
                                                ? "bg-emerald-900/40 text-emerald-300"
                                                : "bg-slate-800 text-slate-200"
                                        }`}
                                    >
                                        {m.role}
                                    </span>
                                    <span>{fmtDate(m.created_at)}</span>
                                    {m.is_flagged && (
                                        <span className="rounded bg-red-950/50 px-1.5 py-0.5 text-xs text-red-300">
                                            flagged
                                        </span>
                                    )}
                                </div>
                                <span className="font-mono text-xs text-slate-500">
                                    {m.chat_title ?? m.chat_id.slice(0, 8)}
                                </span>
                            </div>
                            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-200">
                                {truncated || (
                                    <span className="text-slate-500">
                                        (prazna poruka)
                                    </span>
                                )}
                            </pre>
                        </li>
                    );
                })}
            </ul>
            <Pagination page={page} totalPages={totalPages} onPage={onPage} />
        </div>
    );
}

function Pagination({
    page,
    totalPages,
    onPage,
}: {
    page: number;
    totalPages: number;
    onPage: (p: number) => void;
}) {
    if (totalPages <= 1) return null;
    return (
        <div className="flex items-center justify-end gap-2 text-xs text-slate-400">
            <button
                onClick={() => onPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800 disabled:opacity-40"
            >
                ←
            </button>
            <span>
                {page + 1} / {totalPages}
            </span>
            <button
                onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800 disabled:opacity-40"
            >
                →
            </button>
        </div>
    );
}

function Th({
    children,
    align,
}: {
    children: React.ReactNode;
    align?: "right";
}) {
    return (
        <th
            className={`px-3 py-2 text-xs font-medium uppercase tracking-wide ${
                align === "right" ? "text-right" : "text-left"
            }`}
        >
            {children}
        </th>
    );
}

function Td({
    children,
    align,
    className,
}: {
    children: React.ReactNode;
    align?: "right";
    className?: string;
}) {
    return (
        <td
            className={`px-3 py-2 ${align === "right" ? "text-right" : ""} ${
                className ?? ""
            }`}
        >
            {children}
        </td>
    );
}
