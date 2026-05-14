"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    AdminUnauthorizedError,
    clearAdminToken,
    getAdminToken,
    listUsers,
    triggerCsvDownload,
    type AdminUserSummary,
} from "./lib/adminApi";

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
        });
    } catch {
        return s;
    }
}

function defaultRange(): { from: string; to: string } {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    // datetime-local wants "YYYY-MM-DDTHH:mm"
    const toLocal = (d: Date) =>
        new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
            .toISOString()
            .slice(0, 16);
    return { from: toLocal(from), to: toLocal(to) };
}

function localToIso(local: string): string {
    return new Date(local).toISOString();
}

export default function AdminMaxDashboardPage() {
    const router = useRouter();
    const [range, setRange] = useState(defaultRange);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<AdminUserSummary[]>([]);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        if (!getAdminToken()) {
            router.replace("/adminmax/login");
        }
    }, [router]);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const res = await listUsers({
                from: localToIso(range.from),
                to: localToIso(range.to),
            });
            setData(res.users);
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
    }, []);

    const totals = useMemo(() => {
        return data.reduce(
            (acc, u) => {
                acc.cost += Number(u.cost_usd_total);
                acc.input += u.input_tokens_total;
                acc.output += u.output_tokens_total;
                acc.cacheRead += u.cache_read_input_tokens_total;
                acc.cacheWrite += u.cache_creation_input_tokens_total;
                acc.requests += u.request_count;
                acc.errors += u.error_count;
                return acc;
            },
            {
                cost: 0,
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                requests: 0,
                errors: 0,
            },
        );
    }, [data]);

    async function exportGlobalCsv() {
        setExporting(true);
        try {
            const params = new URLSearchParams({
                from: localToIso(range.from),
                to: localToIso(range.to),
            });
            const fname = `adminmax_usage_all_${range.from.slice(0, 10)}_${range.to.slice(0, 10)}.csv`;
            await triggerCsvDownload(`/usage.csv?${params.toString()}`, fname);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setExporting(false);
        }
    }

    function logout() {
        clearAdminToken();
        router.replace("/adminmax/login");
    }

    return (
        <div className="space-y-6">
            <div className="flex items-end justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                    <h1 className="font-serif text-2xl font-semibold tracking-tight">
                        AdminMax · Potrošnja
                    </h1>
                    <p className="text-sm text-slate-400">
                        Pregled tokena i troška po korisniku.
                    </p>
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
                        onClick={load}
                        disabled={loading}
                        className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-50"
                    >
                        {loading ? "Učitavam…" : "Osvježi"}
                    </button>
                    <button
                        onClick={exportGlobalCsv}
                        disabled={exporting || data.length === 0}
                        className="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                        {exporting ? "Export…" : "CSV (svi)"}
                    </button>
                    <button
                        onClick={logout}
                        className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:text-slate-100"
                    >
                        Odjava
                    </button>
                </div>
            </div>

            {error && (
                <div className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryCard label="Ukupan trošak" value={fmtUsd(totals.cost)} />
                <SummaryCard label="Zahtjevi" value={fmtInt(totals.requests)} />
                <SummaryCard
                    label="Input tokeni"
                    value={fmtInt(totals.input)}
                    subValue={`Output: ${fmtInt(totals.output)}`}
                />
                <SummaryCard
                    label="Cache (read / write)"
                    value={fmtInt(totals.cacheRead)}
                    subValue={`Write: ${fmtInt(totals.cacheWrite)}`}
                />
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                    <thead className="bg-slate-900/60 text-slate-400">
                        <tr>
                            <Th>Email</Th>
                            <Th align="right">Trošak</Th>
                            <Th align="right">Zahtjevi</Th>
                            <Th align="right">Input</Th>
                            <Th align="right">Output</Th>
                            <Th align="right">Cache R / W</Th>
                            <Th align="right">Greške</Th>
                            <Th>Zadnja aktivnost</Th>
                            <Th>{""}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.length === 0 && !loading && (
                            <tr>
                                <td
                                    colSpan={9}
                                    className="px-4 py-6 text-center text-slate-500"
                                >
                                    Nema podataka u zadanom rasponu.
                                </td>
                            </tr>
                        )}
                        {data.map((u) => (
                            <tr
                                key={u.id}
                                className="border-t border-slate-800 hover:bg-slate-900/40"
                            >
                                <Td>
                                    <div className="font-medium text-slate-100">
                                        {u.email}
                                    </div>
                                    {u.display_name && (
                                        <div className="text-xs text-slate-500">
                                            {u.display_name}
                                        </div>
                                    )}
                                </Td>
                                <Td align="right" className="font-mono">
                                    {fmtUsd(Number(u.cost_usd_total))}
                                </Td>
                                <Td align="right">
                                    {fmtInt(u.request_count)}
                                </Td>
                                <Td align="right" className="font-mono">
                                    {fmtInt(u.input_tokens_total)}
                                </Td>
                                <Td align="right" className="font-mono">
                                    {fmtInt(u.output_tokens_total)}
                                </Td>
                                <Td align="right" className="font-mono text-xs">
                                    {fmtInt(u.cache_read_input_tokens_total)} /{" "}
                                    {fmtInt(u.cache_creation_input_tokens_total)}
                                </Td>
                                <Td align="right">
                                    {u.error_count > 0 ? (
                                        <span className="text-red-400">
                                            {u.error_count}
                                        </span>
                                    ) : (
                                        <span className="text-slate-600">0</span>
                                    )}
                                </Td>
                                <Td className="text-xs text-slate-400">
                                    {fmtDate(u.last_used)}
                                </Td>
                                <Td align="right">
                                    <Link
                                        href={`/adminmax/users/${u.id}`}
                                        className="text-xs font-medium text-slate-300 hover:text-white"
                                    >
                                        Detalji →
                                    </Link>
                                </Td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
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

function Th({
    children,
    align,
}: {
    children: React.ReactNode;
    align?: "right";
}) {
    return (
        <th
            className={`px-4 py-2 text-xs font-medium uppercase tracking-wide ${
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
            className={`px-4 py-2 ${align === "right" ? "text-right" : ""} ${
                className ?? ""
            }`}
        >
            {children}
        </td>
    );
}
