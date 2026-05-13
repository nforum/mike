/**
 * Loads the user's MCP connectors and auto-enables any that are turned
 * off. The Word add-in deliberately doesn't ship a full management UI —
 * the user configures connectors in the Max web app once, and from
 * Word they should "just work". This hook implements that contract:
 *
 *   1. On mount (after auth), GET /user/mcp-servers.
 *   2. For every row with `enabled: false`, fire a single PATCH with
 *      `{ enabled: true }`. We do this in parallel and silently swallow
 *      individual failures — a connector that can't be enabled (e.g. an
 *      OAuth one that needs re-auth) will continue to surface as
 *      `last_error: "reauth_required"` to the status button.
 *   3. Re-list once enables settle, so the displayed state matches the
 *      DB after the round-trip.
 *
 * The auto-enable runs once per AuthProvider session, guarded by a ref
 * so re-renders or `refresh()` calls don't keep flipping toggles.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listMcpServers, updateMcpServer, type McpServer } from "../lib/api";

interface UseMcpServersResult {
    servers: McpServer[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

export function useMcpServers(enabled: boolean): UseMcpServersResult {
    const [servers, setServers] = useState<McpServer[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const autoEnabledRef = useRef<boolean>(false);

    const load = useCallback(
        async (autoEnable: boolean): Promise<void> => {
            setLoading(true);
            setError(null);
            try {
                const list = await listMcpServers();
                if (autoEnable) {
                    const disabled = list.filter((s) => !s.enabled);
                    if (disabled.length > 0) {
                        await Promise.allSettled(
                            disabled.map((s) =>
                                updateMcpServer(s.id, { enabled: true }),
                            ),
                        );
                        const refreshed = await listMcpServers();
                        setServers(refreshed);
                        return;
                    }
                }
                setServers(list);
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setServers([]);
            } finally {
                setLoading(false);
            }
        },
        [],
    );

    useEffect(() => {
        if (!enabled) {
            setServers([]);
            autoEnabledRef.current = false;
            return;
        }
        const shouldAutoEnable = !autoEnabledRef.current;
        autoEnabledRef.current = true;
        void load(shouldAutoEnable);
    }, [enabled, load]);

    const refresh = useCallback(async () => {
        await load(false);
    }, [load]);

    return { servers, loading, error, refresh };
}
