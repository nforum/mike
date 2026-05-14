"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Plug, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    listMcpServers,
    listBuiltinMcpServers,
    updateMcpServer,
    updateBuiltinMcpServer,
    type McpServer,
    type BuiltinMcpServer,
} from "@/app/lib/mikeApi";

/**
 * Sit next to "Documents" / "Workflows" in the chat input. Opens a popover
 * where the user toggles each connector on/off. The toggle flips the
 * effective `enabled` state, which the chat backend honors at the start
 * of the next request.
 *
 * Built-in MCP servers (from mike/mcp.json) are mixed into the same list
 * as user-defined connectors with the same plug icon and toggle. They
 * default to enabled for every user; a per-user opt-out is persisted in
 * `user_mcp_builtin_prefs` server-side. URL/headers stay server-side and
 * are not surfaced here.
 */
export function McpToggleButton() {
    const t = useTranslations("mcpToggle");
    const [servers, setServers] = useState<McpServer[] | null>(null);
    const [builtins, setBuiltins] = useState<BuiltinMcpServer[] | null>(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState<Record<string, boolean>>({});

    const reload = useCallback(async () => {
        try {
            const [userList, builtinList] = await Promise.all([
                listMcpServers(),
                listBuiltinMcpServers(),
            ]);
            setServers(userList);
            setBuiltins(builtinList);
        } catch {
            setServers([]);
            setBuiltins([]);
        }
    }, []);

    useEffect(() => {
        if (open) reload();
        else if (servers === null) reload();
    }, [open, reload, servers]);

    const handleToggleUser = async (server: McpServer) => {
        setBusy((s) => ({ ...s, [server.id]: true }));
        setServers((prev) =>
            prev
                ? prev.map((s) =>
                      s.id === server.id ? { ...s, enabled: !s.enabled } : s,
                  )
                : prev,
        );
        try {
            await updateMcpServer(server.id, { enabled: !server.enabled });
        } catch {
            await reload();
        } finally {
            setBusy((s) => ({ ...s, [server.id]: false }));
        }
    };

    const handleToggleBuiltin = async (server: BuiltinMcpServer) => {
        const key = `builtin:${server.slug}`;
        setBusy((s) => ({ ...s, [key]: true }));
        setBuiltins((prev) =>
            prev
                ? prev.map((b) =>
                      b.slug === server.slug ? { ...b, enabled: !b.enabled } : b,
                  )
                : prev,
        );
        try {
            await updateBuiltinMcpServer(server.slug, {
                enabled: !server.enabled,
            });
        } catch {
            await reload();
        } finally {
            setBusy((s) => ({ ...s, [key]: false }));
        }
    };

    const builtinCount = builtins?.length ?? 0;
    const userCount = servers?.length ?? 0;

    if (servers !== null && builtins !== null && userCount === 0 && builtinCount === 0) return null;

    const enabledCount =
        (servers?.filter((s) => s.enabled).length ?? 0) +
        (builtins?.filter((b) => b.enabled).length ?? 0);
    const totalCount = userCount + builtinCount;

    return (
        <DropdownMenu onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Manage connectors for this chat"
                    title={
                        servers === null
                            ? t("loadingConnectors")
                            : t("connectorStatus", { enabled: enabledCount, total: totalCount })
                    }
                    className={`flex items-center gap-1.5 rounded-lg px-2 h-8 text-sm transition-colors ${
                        enabledCount > 0
                            ? "text-blue-600 hover:bg-blue-50"
                            : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    } ${open ? "bg-gray-100" : ""}`}
                >
                    <Plug className="h-3.5 w-3.5" />
                    {enabledCount > 0 && totalCount > 0 && (
                        <span className="text-xs font-medium text-blue-600">
                            {enabledCount}
                        </span>
                    )}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 p-1">
                <DropdownMenuLabel className="text-xs text-gray-500 font-normal">
                    {t("connectors")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {/* Built-in connectors first — they're "preset defaults". */}
                {builtins?.map((b) => (
                    <BuiltinRow
                        key={`builtin:${b.slug}`}
                        server={b}
                        busy={busy[`builtin:${b.slug}`] === true}
                        onToggle={() => handleToggleBuiltin(b)}
                        defaultLabel={t("defaultBadge")}
                    />
                ))}

                {/* User-configured connectors */}
                {servers?.map((s) => (
                    <McpRow
                        key={s.id}
                        server={s}
                        busy={busy[s.id] === true}
                        onToggle={() => handleToggleUser(s)}
                        t={t}
                    />
                ))}

                <DropdownMenuSeparator />
                <a
                    href="/account/mcp"
                    className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 rounded-sm"
                >
                    <Plus className="h-3.5 w-3.5" />
                    {t("manageConnectors")}
                </a>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function BuiltinRow({
    server,
    busy,
    onToggle,
    defaultLabel,
}: {
    server: BuiltinMcpServer;
    busy: boolean;
    onToggle: () => void;
    defaultLabel: string;
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 rounded-sm disabled:opacity-50"
        >
            <span className="flex items-center gap-2 min-w-0">
                <Plug className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                <span className="truncate">{server.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-blue-700/70 bg-blue-50 px-1 py-0.5 rounded shrink-0 leading-none">
                    {defaultLabel}
                </span>
            </span>
            <ToggleSwitch on={server.enabled} />
        </button>
    );
}

function McpRow({
    server,
    busy,
    onToggle,
    t,
}: {
    server: McpServer;
    busy: boolean;
    onToggle: () => void;
    t: (key: string) => string;
}) {
    const safeName =
        server.name.trim().length > 0 ? server.name.trim() : t("untitled");
    return (
        <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 rounded-sm disabled:opacity-50"
        >
            <span className="flex items-center gap-2 min-w-0">
                <Plug className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                <span className="truncate">{safeName}</span>
                {server.last_error && (
                    <AlertCircle
                        className="h-3 w-3 text-red-500 shrink-0"
                        aria-label={`Error: ${server.last_error}`}
                    />
                )}
            </span>
            <ToggleSwitch on={server.enabled} />
        </button>
    );
}

function ToggleSwitch({ on }: { on: boolean }) {
    return (
        <span
            className={`shrink-0 inline-flex items-center w-7 h-4 rounded-full transition-colors ${
                on ? "bg-blue-600" : "bg-gray-300"
            }`}
        >
            <span
                className={`inline-block w-3 h-3 rounded-full bg-white transition-transform ${
                    on ? "translate-x-3.5" : "translate-x-0.5"
                }`}
            />
        </span>
    );
}
