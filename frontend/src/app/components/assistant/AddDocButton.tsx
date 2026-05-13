"use client";

import { useEffect, useRef, useState } from "react";
import {
    PlusIcon,
    Upload,
    LayoutGridIcon,
    Loader2Icon,
    CloudIcon,
    LinkIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    listIntegrations,
    startIntegrationOAuth,
    uploadStandaloneDocument,
    type IntegrationProviderId,
    type IntegrationProviderStatus,
} from "@/app/lib/mikeApi";
import type { MikeDocument } from "../shared/types";

interface Props {
    onSelectDoc: (doc: MikeDocument) => void;
    onBrowseAll: () => void;
    /** Opens the integration file picker modal. Wired up in Phase 5c. */
    onOpenIntegrationPicker?: (provider: IntegrationProviderId) => void;
    selectedDocIds?: string[];
}

export function AddDocButton({
    onSelectDoc,
    onBrowseAll,
    onOpenIntegrationPicker,
    selectedDocIds = [],
}: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [integrations, setIntegrations] =
        useState<IntegrationProviderStatus[] | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const t = useTranslations("documents");

    // Fetch on first dropdown open; show only providers the operator
    // has configured (server-side env vars). Configured-but-not-connected
    // providers render a "Connect <name>…" item that pops the OAuth flow.
    useEffect(() => {
        if (!isOpen || integrations !== null) return;
        let cancelled = false;
        listIntegrations()
            .then((res) => {
                if (cancelled) return;
                setIntegrations(
                    res.providers.filter((p) => p.configured),
                );
            })
            .catch(() => {
                if (cancelled) return;
                // Surface as 'no integrations available' rather than
                // breaking the dropdown entirely.
                setIntegrations([]);
            });
        return () => {
            cancelled = true;
        };
    }, [isOpen, integrations]);

    const handleConnect = async (provider: IntegrationProviderId) => {
        try {
            const { authorize_url } = await startIntegrationOAuth(provider);
            // Open in new tab so the user keeps their chat draft. The
            // backend bounces back to /account/connectors after success;
            // when the user returns we re-fetch the integrations list.
            window.open(authorize_url, "_blank", "noopener,noreferrer");
            // Reset cache so the next open re-checks state.
            setIntegrations(null);
        } catch (err) {
            console.error(`Failed to start ${provider} OAuth:`, err);
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        setUploading(true);
        try {
            const uploaded = await Promise.all(
                files.map((f) => uploadStandaloneDocument(f)),
            );
            uploaded.forEach((doc) => onSelectDoc(doc));
        } catch (err) {
            console.error("Upload failed:", err);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc"
                multiple
                className="hidden"
                onChange={handleUpload}
            />
            <DropdownMenu onOpenChange={setIsOpen}>
                <DropdownMenuTrigger asChild>
                    <button
                        className={`flex items-center gap-1 px-2 h-8 rounded-lg text-sm transition-colors cursor-pointer ${
                            selectedDocIds.length > 0
                                ? "text-black hover:bg-gray-100"
                                : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                        } ${isOpen ? "bg-gray-100" : ""}`}
                        title={t("addDocuments")}
                        aria-label={t("addDocuments")}
                    >
                        {selectedDocIds.length > 0 ? (
                            <span className="font-medium tabular-nums">{selectedDocIds.length}</span>
                        ) : (
                            <PlusIcon
                                className={`h-4 w-4 shrink-0 transition-transform duration-300 ${isOpen ? "rotate-[135deg]" : ""}`}
                            />
                        )}
                        <span className="hidden sm:inline">
                            {selectedDocIds.length === 1
                                ? t("documentLabel")
                                : t("documentsLabel")}
                        </span>
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    className="w-44 z-50"
                    side="bottom"
                    align="start"
                >
                    <DropdownMenuItem
                        className="cursor-pointer"
                        disabled={uploading}
                        onSelect={(e) => {
                            e.preventDefault();
                            fileInputRef.current?.click();
                        }}
                    >
                        {uploading ? (
                            <Loader2Icon className="h-4 w-4 mr-2 animate-spin text-gray-400" />
                        ) : (
                            <Upload className="h-4 w-4 mr-2 text-gray-500" />
                        )}
                        <span className="text-sm">
                            {uploading ? t("uploading") : t("uploadFiles")}
                        </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={onBrowseAll}
                    >
                        <LayoutGridIcon className="h-4 w-4 mr-2 text-gray-500" />
                        <span className="text-sm">{t("browseAll")}</span>
                    </DropdownMenuItem>

                    {integrations && integrations.length > 0 && (
                        <>
                            <DropdownMenuSeparator />
                            {integrations.map((provider) => (
                                <DropdownMenuItem
                                    key={provider.id}
                                    className="cursor-pointer"
                                    onClick={() => {
                                        if (provider.connected) {
                                            onOpenIntegrationPicker?.(
                                                provider.id,
                                            );
                                        } else {
                                            void handleConnect(provider.id);
                                        }
                                    }}
                                >
                                    {provider.connected ? (
                                        <CloudIcon className="h-4 w-4 mr-2 text-blue-600" />
                                    ) : (
                                        <LinkIcon className="h-4 w-4 mr-2 text-gray-400" />
                                    )}
                                    <span className="text-sm">
                                        {provider.connected
                                            ? t("browseProvider", {
                                                  name: provider.display_name,
                                              })
                                            : t("connectProvider", {
                                                  name: provider.display_name,
                                              })}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
}
