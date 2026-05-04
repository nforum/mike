"use client";

import { useCallback, useEffect, useState } from "react";
import {
    AlertCircle,
    Check,
    ChevronUp,
    Loader2,
    Plus,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    createMcpServer,
    deleteMcpServer,
    listMcpServers,
    testMcpServer,
    updateMcpServer,
    type McpServer,
    type McpServerTestResult,
} from "@/app/lib/mikeApi";

type DraftHeader = { key: string; value: string };

type Draft = {
    name: string;
    url: string;
    headers: DraftHeader[];
};

const EMPTY_DRAFT: Draft = {
    name: "",
    url: "",
    headers: [{ key: "", value: "" }],
};

export default function McpServersPage() {
    const [servers, setServers] = useState<McpServer[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [showAdd, setShowAdd] = useState(false);
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
    const [saving, setSaving] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);

    const [testing, setTesting] = useState<Record<string, boolean>>({});
    const [testResults, setTestResults] = useState<
        Record<string, McpServerTestResult>
    >({});

    const reload = useCallback(async () => {
        setLoadError(null);
        try {
            const list = await listMcpServers();
            setServers(list);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Failed to load");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        reload();
    }, [reload]);

    const handleAdd = async () => {
        setAddError(null);
        const name = draft.name.trim();
        const url = draft.url.trim();
        if (!name || !url) {
            setAddError("Name and URL are required.");
            return;
        }
        const headers: Record<string, string> = {};
        for (const h of draft.headers) {
            const k = h.key.trim();
            if (!k) continue;
            headers[k] = h.value;
        }
        setSaving(true);
        try {
            const created = await createMcpServer({ name, url, headers });
            setDraft(EMPTY_DRAFT);
            setShowAdd(false);
            await reload();
            // Auto-discover tools so the user sees the tool list right away
            // without an extra Test click. Errors surface inline via the
            // server card's last_error / testResults render.
            void runAutoTest(created.id);
        } catch (err) {
            setAddError(err instanceof Error ? err.message : "Failed to save");
        } finally {
            setSaving(false);
        }
    };

    const runAutoTest = async (id: string) => {
        setTesting((s) => ({ ...s, [id]: true }));
        try {
            const result = await testMcpServer(id);
            setTestResults((r) => ({ ...r, [id]: result }));
        } catch (err) {
            setTestResults((r) => ({
                ...r,
                [id]: {
                    ok: false,
                    error: err instanceof Error ? err.message : String(err),
                },
            }));
        } finally {
            setTesting((s) => ({ ...s, [id]: false }));
            reload();
        }
    };

    const handleToggleEnabled = async (server: McpServer) => {
        const wasDisabled = !server.enabled;
        try {
            await updateMcpServer(server.id, { enabled: !server.enabled });
            await reload();
            // Auto-test when going disabled → enabled so the user sees
            // immediately if the server still works after re-enabling.
            if (wasDisabled) void runAutoTest(server.id);
        } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to update");
        }
    };

    const handleDelete = async (server: McpServer) => {
        if (!confirm(`Remove connector "${server.name}"?`)) return;
        try {
            await deleteMcpServer(server.id);
            await reload();
        } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to delete");
        }
    };

    const handleTest = async (server: McpServer) => {
        setTesting((s) => ({ ...s, [server.id]: true }));
        try {
            const result = await testMcpServer(server.id);
            setTestResults((r) => ({ ...r, [server.id]: result }));
        } catch (err) {
            setTestResults((r) => ({
                ...r,
                [server.id]: {
                    ok: false,
                    error: err instanceof Error ? err.message : String(err),
                },
            }));
        } finally {
            setTesting((s) => ({ ...s, [server.id]: false }));
            // Reload so last_error reflects the test outcome.
            reload();
        }
    };

    return (
        <div className="space-y-4">
            <div className="pb-2">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-2xl font-medium font-serif">
                        Connectors
                    </h2>
                    <Button
                        onClick={() => setShowAdd((v) => !v)}
                        variant="outline"
                        className="gap-1"
                    >
                        {showAdd ? (
                            <>
                                <ChevronUp className="h-4 w-4" /> Hide form
                            </>
                        ) : (
                            <>
                                <Plus className="h-4 w-4" /> Add connector
                            </>
                        )}
                    </Button>
                </div>
                <p className="text-sm text-gray-500 max-w-2xl">
                    Connectors plug external tools into Mike via the{" "}
                    <a
                        href="https://modelcontextprotocol.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                    >
                        Model Context Protocol
                    </a>{" "}
                    (MCP) &mdash; legal-data sources, web research, internal
                    company APIs, and so on. Tools discovered from each
                    connector become available to the chat assistant under
                    the{" "}
                    <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
                        mcp__&lt;slug&gt;__&lt;tool&gt;
                    </code>{" "}
                    name.
                </p>
            </div>

            {/* Trust trade-off warning. Surfaced once at the top so users
                don't paste URLs and tokens for servers they haven't vetted. */}
            <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-md p-3 text-sm flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <div>
                    <p className="font-medium">
                        Only add connectors you trust
                    </p>
                    <p className="text-xs mt-1 leading-relaxed">
                        A connector&rsquo;s operator can see anything Mike
                        sends in tool calls &mdash; your prompts, document
                        excerpts, and the tool&rsquo;s own response. Custom
                        headers (including{" "}
                        <code className="bg-amber-100 px-1 py-0.5 rounded">
                            Authorization
                        </code>{" "}
                        tokens) are sent on every request.
                    </p>
                </div>
            </div>

            {showAdd && (
                <AddForm
                    draft={draft}
                    setDraft={setDraft}
                    onSave={handleAdd}
                    saving={saving}
                    error={addError}
                />
            )}

            {loading ? (
                <div className="flex items-center gap-2 text-gray-500 py-6">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading
                    servers&hellip;
                </div>
            ) : loadError ? (
                <div className="text-red-600 text-sm flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {loadError}
                </div>
            ) : servers.length === 0 ? (
                <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-md py-6 text-center">
                    No connectors configured yet.
                </div>
            ) : (
                <div className="space-y-3">
                    {servers.map((s) => (
                        <ServerCard
                            key={s.id}
                            server={s}
                            testing={testing[s.id] === true}
                            testResult={testResults[s.id]}
                            onToggle={() => handleToggleEnabled(s)}
                            onDelete={() => handleDelete(s)}
                            onTest={() => handleTest(s)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function AddForm({
    draft,
    setDraft,
    onSave,
    saving,
    error,
}: {
    draft: Draft;
    setDraft: (d: Draft) => void;
    onSave: () => void;
    saving: boolean;
    error: string | null;
}) {
    const updateHeader = (idx: number, patch: Partial<DraftHeader>) => {
        const headers = draft.headers.map((h, i) =>
            i === idx ? { ...h, ...patch } : h,
        );
        setDraft({ ...draft, headers });
    };
    const addHeaderRow = () =>
        setDraft({
            ...draft,
            headers: [...draft.headers, { key: "", value: "" }],
        });
    const removeHeaderRow = (idx: number) =>
        setDraft({
            ...draft,
            headers: draft.headers.filter((_, i) => i !== idx),
        });

    return (
        <div className="border border-gray-200 rounded-md p-4 space-y-3 bg-gray-50">
            <div>
                <label className="text-sm text-gray-600 block mb-1">Name</label>
                <Input
                    placeholder="My connector"
                    value={draft.name}
                    onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                    }
                />
                <p className="text-xs text-gray-400 mt-1">
                    Shown in chat when the assistant calls a tool. Don&rsquo;t
                    paste tokens here &mdash; use the Headers section below
                    for credentials.
                </p>
            </div>
            <div>
                <label className="text-sm text-gray-600 block mb-1">URL</label>
                <Input
                    placeholder="https://example.com/mcp"
                    value={draft.url}
                    onChange={(e) =>
                        setDraft({ ...draft, url: e.target.value })
                    }
                />
                <p className="text-xs text-gray-400 mt-1">
                    Streamable-HTTP MCP endpoint. Must be HTTPS (or
                    http://localhost for local testing).
                </p>
            </div>
            <div>
                <label className="text-sm text-gray-600 block mb-1">
                    Custom headers (optional)
                </label>
                <p className="text-xs text-gray-400 mb-2">
                    Sent on every request. Common usage:{" "}
                    <code className="bg-gray-100 px-1 py-0.5 rounded">
                        Authorization
                    </code>{" "}
                    →{" "}
                    <code className="bg-gray-100 px-1 py-0.5 rounded">
                        Bearer &lt;token&gt;
                    </code>
                    .
                </p>
                <div className="space-y-2">
                    {draft.headers.map((h, idx) => (
                        <div key={idx} className="flex gap-2">
                            <Input
                                placeholder="Header name"
                                value={h.key}
                                onChange={(e) =>
                                    updateHeader(idx, { key: e.target.value })
                                }
                                className="flex-1"
                            />
                            <Input
                                placeholder="Value"
                                value={h.value}
                                onChange={(e) =>
                                    updateHeader(idx, {
                                        value: e.target.value,
                                    })
                                }
                                className="flex-1"
                                type="password"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeHeaderRow(idx)}
                                aria-label="Remove header"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={addHeaderRow}
                        className="gap-1"
                    >
                        <Plus className="h-3 w-3" /> Add header
                    </Button>
                </div>
            </div>
            {error && (
                <div className="text-sm text-red-600 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </div>
            )}
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 leading-relaxed">
                By saving, you confirm you trust this server&rsquo;s operator
                with anything Mike sends to it during tool calls.
            </p>
            <div className="flex justify-end gap-2 pt-2">
                <Button
                    onClick={onSave}
                    disabled={saving}
                    className="bg-black hover:bg-gray-900 text-white"
                >
                    {saving ? (
                        <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            Saving&hellip;
                        </>
                    ) : (
                        "Save server"
                    )}
                </Button>
            </div>
        </div>
    );
}

/**
 * Sanitize a user-supplied server name for safe rendering. Strips Bearer
 * prefixes and obvious secret-looking tokens that users sometimes paste into
 * the Name field by mistake — the chat surface uses this label, so we don't
 * want secrets leaking onto screens / screenshots.
 */
function safeServerName(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "Untitled connector";
    const looksLikeSecret =
        /\b(?:Bearer|Basic|sk-[A-Za-z0-9_-]{8,}|sb_secret_|AIza[A-Za-z0-9_-]{20,})\b/i.test(
            trimmed,
        );
    if (looksLikeSecret) {
        // Best-effort cleanup: strip the secret-shaped substring.
        const cleaned = trimmed
            .replace(
                /\s*\(?(Bearer|Basic)\s+[A-Za-z0-9._~+/\-]+=*\)?/gi,
                "",
            )
            .replace(/sk-[A-Za-z0-9_-]{8,}/g, "")
            .replace(/sb_secret_[A-Za-z0-9_-]+/g, "")
            .replace(/AIza[A-Za-z0-9_-]{20,}/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
        return cleaned || "Untitled connector";
    }
    return trimmed;
}

function ServerCard({
    server,
    testing,
    testResult,
    onToggle,
    onDelete,
    onTest,
}: {
    server: McpServer;
    testing: boolean;
    testResult?: McpServerTestResult;
    onToggle: () => void;
    onDelete: () => void;
    onTest: () => void;
}) {
    const [showDetails, setShowDetails] = useState(false);
    const displayName = safeServerName(server.name);
    const nameWasSanitized = displayName !== server.name.trim();

    return (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-gray-900 truncate">
                            {displayName}
                        </h3>
                        {server.enabled ? (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                Enabled
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                                Disabled
                            </span>
                        )}
                        {server.last_error && (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                                <AlertCircle className="h-3 w-3" />
                                Error
                            </span>
                        )}
                    </div>
                    {nameWasSanitized && (
                        <p className="text-xs text-amber-700 mt-1">
                            Name contained what looks like a secret &mdash;
                            displayed redacted. Edit the server to fix.
                        </p>
                    )}
                    <a
                        href={server.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-gray-500 mt-1 truncate hover:text-gray-700 hover:underline"
                    >
                        {server.url}
                    </a>
                    {server.header_keys.length > 0 && (
                        <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-1">
                            <span>Headers:</span>
                            {server.header_keys.map((k) => (
                                <span
                                    key={k}
                                    className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600"
                                >
                                    {k}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onTest}
                        disabled={testing}
                    >
                        {testing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            "Test"
                        )}
                    </Button>
                    <Button variant="outline" size="sm" onClick={onToggle}>
                        {server.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onDelete}
                        aria-label="Delete server"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Errors / status footer */}
            {testResult && !testResult.ok && (
                <div className="px-4 py-2 text-xs bg-red-50 text-red-700 border-t border-red-100 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="break-words">
                        {testResult.error ?? "Unknown error"}
                    </span>
                </div>
            )}
            {server.last_error && !testResult && (
                <div className="px-4 py-2 text-xs bg-red-50 text-red-700 border-t border-red-100 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="break-words">{server.last_error}</span>
                </div>
            )}

            {/* Tool list */}
            {testResult?.ok && testResult.tools && testResult.tools.length > 0 && (
                <div className="border-t border-gray-100 bg-gray-50">
                    <button
                        type="button"
                        onClick={() => setShowDetails((v) => !v)}
                        className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            <Check className="h-3.5 w-3.5 text-green-600" />
                            Discovered {testResult.tool_count ?? 0} tool
                            {testResult.tool_count === 1 ? "" : "s"}
                        </span>
                        <span className="text-gray-400">
                            {showDetails ? "Hide" : "Show"}
                        </span>
                    </button>
                    {showDetails && (
                        <ul className="divide-y divide-gray-100 bg-white">
                            {testResult.tools.map((t) => (
                                <ToolListItem
                                    key={t.name}
                                    name={t.name}
                                    description={t.description}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

function ToolListItem({
    name,
    description,
}: {
    name: string;
    description: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const trimmed = description.trim();
    const isLong = trimmed.length > 160;
    const shown = expanded || !isLong ? trimmed : trimmed.slice(0, 160) + "…";
    return (
        <li className="px-4 py-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-[11px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">
                    {name}
                </code>
                {isLong && (
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className="text-gray-400 hover:text-gray-600 text-[11px] shrink-0"
                    >
                        {expanded ? "Less" : "More"}
                    </button>
                )}
            </div>
            {trimmed && (
                <p className="text-gray-600 mt-1 leading-relaxed">{shown}</p>
            )}
        </li>
    );
}

