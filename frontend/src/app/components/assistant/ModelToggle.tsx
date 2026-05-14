"use client";

import { useState } from "react";
import { Brain, Check, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isModelAvailable } from "@/app/lib/modelAvailability";

export type ReasoningEffort = "low" | "medium" | "high";

export const REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = [
    "low",
    "medium",
    "high",
] as const;

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";

export interface ModelOption {
    id: string;
    label: string;
    group: "Anthropic" | "Google" | "OpenAI" | "LocalLLM" | "Mistral";
    /**
     * Whether this model accepts a reasoning-effort knob. Mirrors the
     * server-side mapping in backend/src/lib/llm/{claude,openai,gemini}.ts:
     *   - Claude 4.x: `output_config.effort`
     *   - GPT-5 family: `reasoning_effort`
     *   - Gemini 3.x: `thinkingConfig.thinkingLevel`
     * LocalLLM, Mistral, and lite/nano tiers don't expose one and
     * silently ignore the value, so we hide the picker for them.
     */
    supportsReasoningEffort?: boolean;
}

export const MODELS: ModelOption[] = [
    { id: "localllm-main", label: "LocalLLM Main", group: "LocalLLM" },
    { id: "localllm-lite", label: "LocalLLM Lite", group: "LocalLLM" },
    {
        id: "claude-opus-4-7",
        label: "Claude Opus 4.7",
        group: "Anthropic",
        supportsReasoningEffort: true,
    },
    {
        id: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        group: "Anthropic",
        supportsReasoningEffort: true,
    },
    {
        id: "gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        group: "Google",
        supportsReasoningEffort: true,
    },
    {
        id: "gemini-3-flash-preview",
        label: "Gemini 3 Flash",
        group: "Google",
        supportsReasoningEffort: true,
    },
    {
        id: "gpt-5.5",
        label: "GPT-5.5",
        group: "OpenAI",
        supportsReasoningEffort: true,
    },
    { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", group: "OpenAI" },
    { id: "mistral-large-latest", label: "Mistral Large", group: "Mistral" },
    { id: "mistral-medium-latest", label: "Mistral Medium", group: "Mistral" },
    { id: "mistral-small-latest", label: "Mistral Small", group: "Mistral" },
];

// Primary model for the web composer. Backend deploy ships with ANTHROPIC_API_KEY
// wired from Secret Manager (see cloudbuild.yaml), so every signed-in user
// gets Claude Sonnet 4.6 by default without pasting their own key.
export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";

export const ALLOWED_MODEL_IDS = new Set(MODELS.map((m) => m.id));

const REASONING_MODEL_IDS = new Set(
    MODELS.filter((m) => m.supportsReasoningEffort).map((m) => m.id),
);

export function modelSupportsReasoningEffort(modelId: string): boolean {
    return REASONING_MODEL_IDS.has(modelId);
}

const GROUP_ORDER: ModelOption["group"][] = [
    "LocalLLM",
    "Anthropic",
    "Google",
    "OpenAI",
    "Mistral",
];

interface Props {
    value: string;
    onChange: (id: string) => void;
    effort: ReasoningEffort;
    onEffortChange: (effort: ReasoningEffort) => void;
    apiKeys?: {
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
}

export function ModelToggle({
    value,
    onChange,
    effort,
    onEffortChange,
    apiKeys,
}: Props) {
    const t = useTranslations("assistant.modelToggle");
    const [isOpen, setIsOpen] = useState(false);
    const selected = MODELS.find((m) => m.id === value);
    const selectedAvailable = apiKeys
        ? isModelAvailable(value, apiKeys)
        : true;

    const triggerTitle = !selectedAvailable
        ? t("apiKeyMissingTitle")
        : `${t("trigger", { model: selected?.label ?? "Model" })}`;

    return (
        <DropdownMenu onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={t("triggerAria", {
                        model: selected?.label ?? "Model",
                    })}
                    className={`relative flex items-center justify-center rounded-lg h-8 w-8 transition-colors cursor-pointer text-gray-400 hover:bg-gray-100 hover:text-gray-700 ${isOpen ? "bg-gray-100 text-gray-700" : ""}`}
                    title={triggerTitle}
                >
                    <Brain className="h-4 w-4" />
                    {!selectedAvailable && (
                        <AlertCircle className="absolute -top-0.5 -right-0.5 h-3 w-3 text-red-500" />
                    )}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="w-72 z-50"
                side="top"
                align="end"
            >
                {GROUP_ORDER.map((group, gi) => {
                    const items = MODELS.filter((m) => m.group === group);
                    if (items.length === 0) return null;
                    return (
                        <div key={group}>
                            {gi > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-400">
                                {group}
                            </DropdownMenuLabel>
                            {items.map((m) => {
                                const available = apiKeys
                                    ? isModelAvailable(m.id, apiKeys)
                                    : true;
                                const isSelected = m.id === value;
                                const showsEffort =
                                    !!m.supportsReasoningEffort && available;
                                return (
                                    <DropdownMenuItem
                                        key={m.id}
                                        className="cursor-pointer flex flex-col items-stretch gap-1.5 py-1.5"
                                        onSelect={(e) => {
                                            e.preventDefault();
                                            onChange(m.id);
                                        }}
                                    >
                                        <div className="flex items-center w-full">
                                            <span
                                                className={`flex-1 ${available ? "" : "text-gray-400"}`}
                                            >
                                                {m.label}
                                            </span>
                                            {!available && (
                                                <AlertCircle
                                                    className="h-3.5 w-3.5 text-red-500 ml-1"
                                                    aria-label={t(
                                                        "apiKeyMissingTitle",
                                                    )}
                                                />
                                            )}
                                            {isSelected && available && (
                                                <Check className="h-3.5 w-3.5 text-gray-600 ml-1" />
                                            )}
                                        </div>
                                        {showsEffort && (
                                            <EffortPicker
                                                value={
                                                    isSelected
                                                        ? effort
                                                        : DEFAULT_REASONING_EFFORT
                                                }
                                                onChange={(next) => {
                                                    if (!isSelected)
                                                        onChange(m.id);
                                                    onEffortChange(next);
                                                }}
                                            />
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

interface EffortPickerProps {
    value: ReasoningEffort;
    onChange: (effort: ReasoningEffort) => void;
}

function EffortPicker({ value, onChange }: EffortPickerProps) {
    const t = useTranslations("assistant.modelToggle.effort");
    return (
        <div
            className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 p-0.5"
            role="radiogroup"
            aria-label={t("label")}
        >
            {REASONING_EFFORT_VALUES.map((option) => {
                const active = option === value;
                return (
                    <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        title={t(`${option}Title`)}
                        onClick={(e) => {
                            e.stopPropagation();
                            onChange(option);
                        }}
                        className={`flex-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                            active
                                ? "bg-white text-gray-800 shadow-sm border border-gray-200"
                                : "text-gray-500 hover:text-gray-700"
                        }`}
                    >
                        {t(option)}
                    </button>
                );
            })}
        </div>
    );
}
