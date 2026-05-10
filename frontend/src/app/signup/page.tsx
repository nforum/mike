"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SiteLogo } from "@/components/site-logo";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";

export default function SignupPage() {
    const router = useRouter();
    const { isAuthenticated, authLoading } = useAuth();
    const t = useTranslations("signup");

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.replace("/assistant");
        }
    }, [authLoading, isAuthenticated, router]);

    return (
        <div className="min-h-dvh bg-white flex items-start justify-center px-6 pt-32 md:pt-40 pb-10 relative">
            <div className="absolute top-4 md:top-8 left-1/2 -translate-x-1/2">
                <SiteLogo size="md" className="md:text-4xl" asLink />
            </div>
            <div className="w-full max-w-md">
                <div className="bg-white border border-gray-200 rounded-2xl p-8">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-left text-2xl font-serif">
                            {t("title")}
                        </h2>
                        <div className="bg-gray-100 p-1 rounded-md flex text-xs font-medium">
                            <Link
                                href="/login"
                                className="px-3 py-1 text-gray-500 hover:text-gray-900"
                            >
                                {t("logIn")}
                            </Link>
                            <span className="px-3 py-1 bg-white rounded-sm shadow-sm text-gray-900">
                                {t("signUp")}
                            </span>
                        </div>
                    </div>

                    <div className="text-center py-6">
                        <div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                            <svg
                                className="h-8 w-8 text-gray-400"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1.5}
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                                />
                            </svg>
                        </div>
                        <p className="text-gray-700 mb-2 font-medium">
                            {t("managedByEulex")}
                        </p>
                        <p className="text-gray-500 text-sm mb-6">
                            {t("createOnEulex")}
                        </p>
                        <a
                            href="https://eulex.ai/signup"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center w-full py-3 px-6 rounded-xl bg-black text-white font-medium hover:bg-gray-900 transition-colors"
                        >
                            {t("createAccountOnEulex")}
                            <svg
                                className="w-4 h-4 ml-2"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={2}
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                                />
                            </svg>
                        </a>
                    </div>

                    <div className="border-t border-gray-100 pt-4 text-center">
                        <p className="text-xs text-gray-400">
                            {t("alreadyHaveAccount")}{" "}
                            <Link
                                href="/login"
                                className="text-blue-600 hover:underline"
                            >
                                {t("signIn")}
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
