"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { MikeIcon } from "@/components/chat/mike-icon";
import { ChatInput } from "./ChatInput";
import { SelectAssistantProjectModal } from "./SelectAssistantProjectModal";
import type { MikeMessage } from "../shared/types";

interface InitialViewProps {
    onSubmit: (message: MikeMessage) => void;
}

const ICON_SIZE = 44;
const GAP = 16; // gap-4 = 1rem = 16px

export function InitialView({ onSubmit }: InitialViewProps) {
    const { user } = useAuth();
    const { profile } = useUserProfile();
    const t = useTranslations("assistant");
    const [loaded, setLoaded] = useState(false);
    const [projectModalOpen, setProjectModalOpen] = useState(false);
    const [iconOffset, setIconOffset] = useState(0);
    const [textOffset, setTextOffset] = useState(0);
    const textRef = useRef<HTMLHeadingElement>(null);

    const username =
        profile?.displayName?.trim() || user?.email?.split("@")[0] || "there";

    useEffect(() => {
        const t = setTimeout(() => setLoaded(true), 100);
        return () => clearTimeout(t);
    }, []);

    return (
        <div className="flex flex-col h-full w-full px-6">
            <div className="flex-1 flex flex-col items-center justify-center">
                <div className="flex-col items-center w-full max-w-4xl relative px-0 xl:px-8">
                    <div className="mb-10 flex items-center justify-center h-[50px]">
                        <div
                            className="flex items-center justify-center transition-all duration-[900ms] ease-in-out"
                            style={{
                                gap: loaded ? `${GAP}px` : "0px",
                            }}
                        >
                            <div className="z-10 relative shrink-0">
                                <MikeIcon size={ICON_SIZE} />
                            </div>
                            <div
                                className="transition-all duration-[900ms] ease-in-out overflow-hidden flex items-center"
                                style={{
                                    maxWidth: loaded ? "800px" : "0px",
                                    opacity: loaded ? 1 : 0,
                                }}
                            >
                                <h1 className="text-4xl font-serif font-light text-gray-900 whitespace-nowrap pt-1">
                                    {t("greeting", { username })}
                                </h1>
                            </div>
                        </div>
                    </div>

                    <ChatInput
                        onSubmit={onSubmit}
                        onCancel={() => {}}
                        isLoading={false}
                        onProjectsClick={() => setProjectModalOpen(true)}
                    />

                    <div className="text-center">
                        <p className="text-xs py-3 mb-3 text-gray-500">
                            {t("disclaimer")}
                        </p>
                    </div>
                </div>
            </div>

            <SelectAssistantProjectModal
                open={projectModalOpen}
                onClose={() => setProjectModalOpen(false)}
            />
        </div>
    );
}
