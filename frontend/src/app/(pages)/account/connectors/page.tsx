"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
    AlertCircle,
    CheckCircle2,
    CloudIcon,
    Loader2,
    LinkIcon,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    disconnectIntegration,
    listIntegrations,
    startIntegrationOAuth,
    type IntegrationProviderId,
    type IntegrationProviderStatus,
} from "@/app/lib/mikeApi";
import { useConfirmDialog } from "@/app/components/modals/confirm-dialog";

/**
 * /account/connectors — manage native file-source integrations
 * (Google Drive / OneDrive / Box). Lives next to the existing MCP
 * connectors tab; this one is purely about pulling files into Max.
 *
 * The OAuth round-trip lands the browser back here with
 *   ?integration=google_drive&ok=1
 * (or &ok=0&error=...) — we surface that as a transient toast and
 * re-fetch the list so the row flips to "Connected".
 */
export default function ConnectorsPage() {
    const t = useTranslations("connectorsPage");
    const tDelete = useTranslations("confirmDelete");
    const sp = useSearchParams();
    const { confirm: confirmDialog, dialog: confirmDialogEl } =
        useConfirmDialog();

    const [providers, setProviders] = useState<
        IntegrationProviderStatus[] | null
    >(null);
    const [busy, setBusy] = useState<Record<string, boolean>>({});
    const [toast, setToast] = useState<{
        kind: "ok" | "err";
        message: string;
    } | null>(null);

    const reload = useCallback(async () => {
        try {
            const res = await listIntegrations();
            setProviders(res.providers);
        } catch (err) {
            setProviders([]);
            setToast({
                kind: "err",
                message:
                    err instanceof Error
                        ? err.message
                        : t("errors.loadFailed"),
            });
        }
    }, [t]);

    useEffect(() => {
        void reload();
    }, [reload]);

    // Surface the OAuth callback result that the backend bounced us
    // back with. Shown for ~5s; we DO NOT strip the params from the URL
    // because the user may want to refresh the page (idempotent).
    useEffect(() => {
        const integration = sp.get("integration");
        const ok = sp.get("ok");
        const error = sp.get("error");
        if (!integration) return;
        if (ok === "1") {
            setToast({
                kind: "ok",
                message: t("toasts.connected", { name: integration }),
            });
        } else {
            setToast({
                kind: "err",
                message: error
                    ? t("toasts.failedWithError", {
                          name: integration,
                          error,
                      })
                    : t("toasts.failed", { name: integration }),
            });
        }
        const id = setTimeout(() => setToast(null), 6000);
        return () => clearTimeout(id);
    }, [sp, t]);

    const handleConnect = async (provider: IntegrationProviderId) => {
        setBusy((b) => ({ ...b, [provider]: true }));
        try {
            const { authorize_url } = await startIntegrationOAuth(provider);
            window.location.href = authorize_url;
        } catch (err) {
            setBusy((b) => ({ ...b, [provider]: false }));
            setToast({
                kind: "err",
                message:
                    err instanceof Error ? err.message : t("errors.startFailed"),
            });
        }
    };

    const handleDisconnect = async (provider: IntegrationProviderStatus) => {
        const ok = await confirmDialog({
            title: tDelete("connectorTitle"),
            message: tDelete("connectorBody", {
                name: provider.display_name,
            }),
            confirmLabel: tDelete("disconnectAction"),
            destructive: true,
        });
        if (!ok) return;
        setBusy((b) => ({ ...b, [provider.id]: true }));
        try {
            await disconnectIntegration(provider.id);
            await reload();
        } catch (err) {
            setToast({
                kind: "err",
                message:
                    err instanceof Error
                        ? err.message
                        : t("errors.disconnectFailed"),
            });
        } finally {
            setBusy((b) => ({ ...b, [provider.id]: false }));
        }
    };

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

            {toast && (
                <div
                    className={`rounded-md border px-3 py-2 text-sm flex items-start gap-2 ${
                        toast.kind === "ok"
                            ? "border-green-200 bg-green-50 text-green-800"
                            : "border-red-200 bg-red-50 text-red-800"
                    }`}
                >
                    {toast.kind === "ok" ? (
                        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                    ) : (
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    )}
                    <span>{toast.message}</span>
                </div>
            )}

            {providers === null ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("loading")}
                </div>
            ) : providers.length === 0 ? (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
                    {t("empty")}
                </div>
            ) : (
                <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                    {providers.map((p) => (
                        <li
                            key={p.id}
                            className="flex items-center justify-between gap-4 p-4"
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <CloudIcon
                                        className={`h-4 w-4 shrink-0 ${
                                            p.connected
                                                ? "text-blue-600"
                                                : "text-gray-400"
                                        }`}
                                    />
                                    <span className="font-medium text-sm">
                                        {p.display_name}
                                    </span>
                                    {!p.configured && (
                                        <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                                            {t("notConfigured")}
                                        </span>
                                    )}
                                </div>
                                {p.connected ? (
                                    <p className="text-xs text-gray-500 mt-1 truncate">
                                        {t("connectedAs", {
                                            email:
                                                p.account_email ??
                                                p.account_name ??
                                                "—",
                                        })}
                                    </p>
                                ) : (
                                    <p className="text-xs text-gray-400 mt-1">
                                        {t("notConnected")}
                                    </p>
                                )}
                            </div>

                            {p.configured ? (
                                p.connected ? (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={busy[p.id]}
                                        onClick={() => handleDisconnect(p)}
                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    >
                                        {busy[p.id] ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4 mr-1" />
                                        )}
                                        {t("disconnect")}
                                    </Button>
                                ) : (
                                    <Button
                                        size="sm"
                                        disabled={busy[p.id]}
                                        onClick={() => handleConnect(p.id)}
                                        className="bg-black hover:bg-gray-900 text-white"
                                    >
                                        {busy[p.id] ? (
                                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                        ) : (
                                            <LinkIcon className="h-4 w-4 mr-1" />
                                        )}
                                        {t("connect")}
                                    </Button>
                                )
                            ) : (
                                <span className="text-xs text-gray-400">
                                    {t("contactAdmin")}
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {confirmDialogEl}
        </div>
    );
}
