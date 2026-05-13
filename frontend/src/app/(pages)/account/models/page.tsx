"use client";

import { useEffect, useState } from "react";
import {
    AlertCircle,
    Check,
    ChevronDown,
    Eye,
    EyeOff,
    Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { MODELS } from "@/app/components/assistant/ModelToggle";
import {
    isModelAvailable,
    modelGroupToProvider,
    providerLabel,
} from "@/app/lib/modelAvailability";

export default function ModelsAndApiKeysPage() {
    const { profile, updateModelPreference, updateApiKey } = useUserProfile();
    const t = useTranslations("models");
    const tc = useTranslations("common");

    return (
        <div className="space-y-4">
            {/* Model Preferences */}
            <div className="pb-6">
                <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-2xl font-medium font-serif">
                        {t("title")}
                    </h2>
                </div>
                <div className="space-y-4 max-w-md">
                    <div>
                        <label className="text-sm text-gray-600 block mb-2">
                            {t("tabularModel")}
                        </label>
                        <TabularModelDropdown
                            value={
                                profile?.tabularModel ??
                                "vllm-main"
                            }
                            apiKeys={{
                                claudeApiKey: profile?.claudeApiKey ?? null,
                                geminiApiKey: profile?.geminiApiKey ?? null,
                                openaiApiKey: profile?.openaiApiKey ?? null,
                                mistralApiKey: profile?.mistralApiKey ?? null,
                                serverKeys: profile?.serverKeys,
                            }}
                            onChange={(id) =>
                                updateModelPreference("tabularModel", id)
                            }
                        />
                        <p className="text-xs text-gray-500 mt-2">
                            {t("localLlmNote")}
                        </p>
                    </div>
                </div>
            </div>

            {/* API Keys */}
            <div className="py-6">
                <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-2xl font-medium font-serif">
                        {t("apiKeys.title")}
                    </h2>
                </div>
                <p className="text-sm text-gray-500 mb-4 max-w-xl">
                    {t("apiKeys.description")}
                </p>
                <p className="text-xs text-gray-400 mb-4 max-w-xl">
                    {t("apiKeys.titleGenNote")}
                </p>
                <div className="space-y-4 max-w-xl">
                    <ApiKeyField
                        label={t("apiKeys.anthropic")}
                        placeholder="sk-ant-…"
                        initialValue={profile?.claudeApiKey ?? ""}
                        serverProvided={!!profile?.serverKeys?.claude}
                        onSave={(value) =>
                            updateApiKey("claude", value.trim() || null)
                        }
                    />
                    <ApiKeyField
                        label={t("apiKeys.google")}
                        placeholder="AI…"
                        initialValue={profile?.geminiApiKey ?? ""}
                        serverProvided={!!profile?.serverKeys?.gemini}
                        onSave={(value) =>
                            updateApiKey("gemini", value.trim() || null)
                        }
                    />
                    <ApiKeyField
                        label={t("apiKeys.openai")}
                        placeholder="sk-…"
                        initialValue={profile?.openaiApiKey ?? ""}
                        serverProvided={!!profile?.serverKeys?.openai}
                        onSave={(value) =>
                            updateApiKey("openai", value.trim() || null)
                        }
                    />
                    <ApiKeyField
                        label={t("apiKeys.mistral")}
                        placeholder="sk-…"
                        initialValue={profile?.mistralApiKey ?? ""}
                        serverProvided={!!profile?.serverKeys?.mistral}
                        onSave={(value) =>
                            updateApiKey("mistral", value.trim() || null)
                        }
                    />
                </div>
            </div>
        </div>
    );
}

function TabularModelDropdown({
    value,
    onChange,
    apiKeys,
}: {
    value: string;
    onChange: (id: string) => void;
    apiKeys: {
        claudeApiKey: string | null;
        geminiApiKey: string | null;
        openaiApiKey: string | null;
        mistralApiKey: string | null;
        serverKeys?: {
            claude?: boolean;
            gemini?: boolean;
            openai?: boolean;
            mistral?: boolean;
        };
    };
}) {
    const t = useTranslations("models");
    const [isOpen, setIsOpen] = useState(false);
    const selected = MODELS.find((m) => m.id === value);
    const selectedAvailable = isModelAvailable(value, apiKeys);
    const groups: ("LocalLLM" | "Anthropic" | "Google" | "OpenAI" | "Mistral")[] = ["LocalLLM", "Anthropic", "Google", "OpenAI", "Mistral"];

    return (
        <DropdownMenu onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm flex items-center justify-between gap-2 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black/10"
                >
                    <span className="flex items-center gap-2 min-w-0">
                        {!selectedAvailable && (
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                        )}
                        <span className="truncate text-gray-900">
                            {selected?.label ?? t("selectModel")}
                        </span>
                    </span>
                    <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="z-50"
                style={{ width: "var(--radix-dropdown-menu-trigger-width)" }}
                align="start"
            >
                {groups.map((group, gi) => {
                    const items = MODELS.filter((m) => m.group === group);
                    if (items.length === 0) return null;
                    return (
                        <div key={group}>
                            {gi > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-400">
                                {group}
                            </DropdownMenuLabel>
                            {items.map((m) => {
                                const provider = modelGroupToProvider(m.group);
                                const available = isModelAvailable(
                                    m.id,
                                    apiKeys,
                                );
                                const tooltip = !available && m.group !== "LocalLLM"
                                    ? t("apiKeys.addKeyTooltip", { provider: providerLabel(provider) })
                                    : undefined;
                                return (
                                    <DropdownMenuItem
                                        key={m.id}
                                        className="cursor-pointer"
                                        onSelect={() => onChange(m.id)}
                                        title={tooltip}
                                    >
                                        <span
                                            className={`flex-1 ${available ? "" : m.group === "LocalLLM" ? "" : "text-gray-400"}`}
                                        >
                                            {m.label}
                                        </span>
                                        {!available && m.group !== "LocalLLM" && (
                                            <AlertCircle className="h-3.5 w-3.5 text-red-500 ml-1" />
                                        )}
                                        {m.id === value && available && (
                                            <Check className="h-3.5 w-3.5 text-gray-600 ml-1" />
                                        )}
                                    </DropdownMenuItem>
                                );
                            })}
                        </div>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function ApiKeyField({
    label,
    placeholder,
    initialValue,
    serverProvided = false,
    onSave,
}: {
    label: string;
    placeholder: string;
    initialValue: string;
    /**
     * Backend reports a server-level fallback key is wired up for this
     * provider (e.g. via Cloud Secret Manager → ANTHROPIC_API_KEY). When
     * the user hasn't pasted their own key, we tell them "Max will use
     * the shared key" instead of leaving the field looking empty + sad.
     */
    serverProvided?: boolean;
    onSave: (value: string) => Promise<boolean>;
}) {
    const t = useTranslations("models");
    const tc = useTranslations("common");
    const [value, setValue] = useState(initialValue);
    const [reveal, setReveal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    const dirty = value !== initialValue;
    const usingSharedKey = serverProvided && !initialValue;
    const effectivePlaceholder = usingSharedKey
        ? t("apiKeys.sharedKeyPlaceholder")
        : placeholder;

    const handleSave = async () => {
        setIsSaving(true);
        const ok = await onSave(value);
        setIsSaving(false);
        if (ok) {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } else {
            alert(t("apiKeys.failedSave", { label }));
        }
    };

    return (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <label className="text-sm text-gray-600">{label}</label>
                {usingSharedKey && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] px-2 py-0.5">
                        <Sparkles className="h-3 w-3" />
                        {t("apiKeys.sharedKeyBadge")}
                    </span>
                )}
            </div>
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Input
                        type={reveal ? "text" : "password"}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={effectivePlaceholder}
                        className="pr-10"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <button
                        type="button"
                        onClick={() => setReveal((r) => !r)}
                        className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600"
                        aria-label={reveal ? "Hide key" : "Show key"}
                    >
                        {reveal ? (
                            <EyeOff className="h-4 w-4" />
                        ) : (
                            <Eye className="h-4 w-4" />
                        )}
                    </button>
                </div>
                <Button
                    onClick={handleSave}
                    disabled={isSaving || !dirty || saved}
                    className="min-w-[80px] transition-all bg-black hover:bg-gray-900 text-white"
                >
                    {isSaving ? (
                        tc("saving")
                    ) : saved ? (
                        <>
                            <Check className="h-4 w-3" />
                            {tc("saved")}
                        </>
                    ) : (
                        tc("save")
                    )}
                </Button>
            </div>
            {usingSharedKey && (
                <p className="mt-1 text-xs text-gray-400">
                    {t("apiKeys.sharedKeyHint")}
                </p>
            )}
        </div>
    );
}
