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
            await createMcpServer({ name, url, headers });
            setDraft(EMPTY_DRAFT);
            setShowAdd(false);
            await reload();
        } catch (err) {
            setAddError(err instanceof Error ? err.message : "Failed to save");
        } finally {
            setSaving(false);
        }
    };

    const handleToggleEnabled = async (server: McpServer) => {
        try {
            await updateMcpServer(server.id, { enabled: !server.enabled });
            await reload();
        } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to update");
        }
    };

    const handleDelete = async (server: McpServer) => {
        if (!confirm(`Remove MCP server "${server.name}"?`)) return;
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
                        MCP Servers
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
                                <Plus className="h-4 w-4" /> Add server
                            </>
                        )}
                    </Button>
                </div>
                <p className="text-sm text-gray-500 max-w-2xl">
                    Connect external{" "}
                    <a
                        href="https://modelcontextprotocol.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                    >
                        Model Context Protocol
                    </a>{" "}
                    servers to extend Mike with extra tools (legal-data
                    sources, web research, internal company APIs, &hellip;).
                    Tools discovered from each server become available to the
                    chat assistant under the{" "}
                    <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
                        mcp__&lt;slug&gt;__&lt;tool&gt;
                    </code>{" "}
                    name.
                </p>
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
                    No MCP servers configured yet.
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
                    placeholder="My MCP server"
                    value={draft.name}
                    onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                    }
                />
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
    return (
        <div className="border border-gray-200 rounded-md p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{server.name}</span>
                        <span
                            className={`text-xs px-2 py-0.5 rounded ${
                                server.enabled
                                    ? "bg-green-100 text-green-700"
                                    : "bg-gray-100 text-gray-500"
                            }`}
                        >
                            {server.enabled ? "Enabled" : "Disabled"}
                        </span>
                        {server.last_error && (
                            <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">
                                Last error
                            </span>
                        )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 truncate">
                        {server.url}
                    </div>
                    {server.header_keys.length > 0 && (
                        <div className="text-xs text-gray-400 mt-1">
                            Headers: {server.header_keys.join(", ")}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onTest}
                        disabled={testing}
                    >
                        {testing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            "Test"
                        )}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onToggle}
                    >
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

            {testResult && (
                <div
                    className={`mt-3 text-xs rounded p-2 ${
                        testResult.ok
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-700"
                    }`}
                >
                    {testResult.ok ? (
                        <div className="flex items-center gap-2">
                            <Check className="h-3 w-3" />
                            Discovered {testResult.tool_count ?? 0} tool
                            {testResult.tool_count === 1 ? "" : "s"}.
                            {testResult.tools && testResult.tools.length > 0 && (
                                <button
                                    type="button"
                                    className="underline"
                                    onClick={() => setShowDetails((v) => !v)}
                                >
                                    {showDetails ? "Hide" : "Show"} list
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-start gap-2">
                            <AlertCircle className="h-3 w-3 mt-0.5" />
                            <span>
                                {testResult.error ?? "Unknown error"}
                            </span>
                        </div>
                    )}
                    {showDetails && testResult.tools && (
                        <ul className="mt-2 space-y-1 list-disc list-inside text-gray-700">
                            {testResult.tools.map((t) => (
                                <li key={t.name}>
                                    <span className="font-mono text-xs">
                                        {t.name}
                                    </span>
                                    {t.description ? ` — ${t.description}` : ""}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {server.last_error && !testResult && (
                <div className="mt-3 text-xs rounded p-2 bg-red-50 text-red-700">
                    <AlertCircle className="h-3 w-3 inline mr-1" />
                    {server.last_error}
                </div>
            )}
        </div>
    );
}

