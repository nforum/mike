"use client";

import { AlertTriangle, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

type DialogKind = "confirm" | "alert";

type DialogState = {
    open: boolean;
    kind: DialogKind;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    destructive: boolean;
    resolve: ((value: boolean) => void) | null;
};

const DEFAULT_STATE: DialogState = {
    open: false,
    kind: "confirm",
    title: "",
    message: "",
    confirmLabel: "OK",
    cancelLabel: "Cancel",
    destructive: false,
    resolve: null,
};

export type ConfirmOptions = {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
};

export type AlertOptions = {
    title?: string;
    message: string;
    confirmLabel?: string;
};

/**
 * Promise-based replacement for the browser's native `window.confirm()` and
 * `window.alert()`. Chrome silently auto-dismisses native dialogs after a
 * page has shown several modals (e.g. an OAuth popup flow), which manifests
 * as the dialog "flickering" and the user's intent being dropped on the
 * floor. Routing those calls through an in-app modal sidesteps that quirk
 * entirely and lets us style the prompt to match the rest of the UI.
 */
export function useConfirmDialog() {
    const [state, setState] = useState<DialogState>(DEFAULT_STATE);
    const t = useTranslations("confirmDialog");
    const tc = useTranslations("common");

    const confirm = useCallback(
        (opts: ConfirmOptions): Promise<boolean> =>
            new Promise<boolean>((resolve) => {
                setState({
                    open: true,
                    kind: "confirm",
                    title: opts.title ?? t("confirm"),
                    message: opts.message,
                    confirmLabel: opts.confirmLabel ?? t("confirm"),
                    cancelLabel: opts.cancelLabel ?? tc("cancel"),
                    destructive: opts.destructive ?? false,
                    resolve,
                });
            }),
        [t, tc],
    );

    const alertDialog = useCallback(
        (opts: AlertOptions): Promise<void> =>
            new Promise<void>((resolve) => {
                setState({
                    open: true,
                    kind: "alert",
                    title: opts.title ?? t("notice"),
                    message: opts.message,
                    confirmLabel: opts.confirmLabel ?? t("ok"),
                    cancelLabel: "",
                    destructive: false,
                    resolve: () => resolve(),
                });
            }),
        [t],
    );

    const close = useCallback(
        (value: boolean) => {
            state.resolve?.(value);
            setState(DEFAULT_STATE);
        },
        [state],
    );

    const dialog = useMemo(() => {
        if (!state.open) return null;
        return (
            <ConfirmDialog
                kind={state.kind}
                title={state.title}
                message={state.message}
                confirmLabel={state.confirmLabel}
                cancelLabel={state.cancelLabel}
                destructive={state.destructive}
                onConfirm={() => close(true)}
                onCancel={() => close(false)}
            />
        );
    }, [state, close]);

    return { confirm, alert: alertDialog, dialog };
}

function ConfirmDialog({
    kind,
    title,
    message,
    confirmLabel,
    cancelLabel,
    destructive,
    onConfirm,
    onCancel,
}: {
    kind: DialogKind;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    destructive: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    if (typeof document === "undefined") return null;

    return createPortal(
        <>
            <div
                className="fixed inset-0 bg-black/40 z-[199]"
                onClick={kind === "confirm" ? onCancel : onConfirm}
            />
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[200] w-full max-w-md px-4"
            >
                <div className="relative bg-white rounded-2xl shadow-2xl p-6">
                    <button
                        onClick={kind === "confirm" ? onCancel : onConfirm}
                        className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 transition-colors"
                        aria-label="Close"
                    >
                        <X className="h-5 w-5" />
                    </button>

                    <div className="flex items-start gap-3 mb-4">
                        {destructive && (
                            <div className="shrink-0 mt-0.5 rounded-full bg-red-50 p-2">
                                <AlertTriangle className="h-5 w-5 text-red-600" />
                            </div>
                        )}
                        <div className="flex-1">
                            <h2
                                id="confirm-dialog-title"
                                className="text-lg font-medium text-gray-900"
                            >
                                {title}
                            </h2>
                            <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">
                                {message}
                            </p>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        {kind === "confirm" && (
                            <Button
                                variant="outline"
                                onClick={onCancel}
                                autoFocus
                            >
                                {cancelLabel}
                            </Button>
                        )}
                        <Button
                            onClick={onConfirm}
                            className={
                                destructive
                                    ? "bg-red-600 hover:bg-red-700 text-white"
                                    : "bg-black hover:bg-gray-900 text-white"
                            }
                            autoFocus={kind === "alert"}
                        >
                            {confirmLabel}
                        </Button>
                    </div>
                </div>
            </div>
        </>,
        document.body,
    );
}
