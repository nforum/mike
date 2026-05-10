"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogOut, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { deleteAccount } from "@/app/lib/mikeApi";

export default function AccountPage() {
    const router = useRouter();
    const { user, signOut } = useAuth();
    const { profile, updateDisplayName, updateOrganisation } = useUserProfile();
    const t = useTranslations("account");
    const tc = useTranslations("common");
    const [displayName, setDisplayName] = useState("");
    const [isSavingName, setIsSavingName] = useState(false);
    const [saved, setSaved] = useState(false);
    const [organisation, setOrganisation] = useState("");
    const [isSavingOrg, setIsSavingOrg] = useState(false);
    const [orgSaved, setOrgSaved] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        if (profile?.displayName) {
            setDisplayName(profile.displayName);
        }
        if (profile?.organisation) {
            setOrganisation(profile.organisation);
        }
    }, [profile]);

    const handleLogout = async () => {
        await signOut();
        router.push("/");
    };

    const handleDeleteAccount = async () => {
        setIsDeleting(true);
        try {
            await deleteAccount();
            await signOut();
            router.push("/");
        } catch {
            setIsDeleting(false);
            setDeleteConfirm(false);
            alert(t("alerts.failedDeleteAccount"));
        }
    };

    const handleSaveDisplayName = async () => {
        setIsSavingName(true);
        const success = await updateDisplayName(displayName.trim());
        setIsSavingName(false);

        if (success) {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } else {
            alert(t("alerts.failedUpdateName"));
        }
    };

    const handleSaveOrganisation = async () => {
        setIsSavingOrg(true);
        const success = await updateOrganisation(organisation.trim());
        setIsSavingOrg(false);

        if (success) {
            setOrgSaved(true);
            setTimeout(() => setOrgSaved(false), 2000);
        } else {
            alert(t("alerts.failedUpdateOrg"));
        }
    };

    if (!user) return null;

    return (
        <div className="space-y-4">
            {/* Profile Settings */}
            <div className="pb-6">
                <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-2xl font-medium font-serif">{t("profile.title")}</h2>
                </div>
                <div className="space-y-4">
                    <div>
                        <label className="text-sm text-gray-600 block mb-2">
                            {t("profile.displayName")}
                        </label>
                        <div className="flex gap-2">
                            <Input
                                type="text"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                placeholder={t("profile.displayNamePlaceholder")}
                                className="flex-1"
                            />
                            <Button
                                onClick={handleSaveDisplayName}
                                disabled={
                                    isSavingName || !displayName.trim() || saved
                                }
                                className="min-w-[80px] transition-all bg-black hover:bg-gray-900 text-white"
                            >
                                {isSavingName ? (
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
                    </div>
                    <div>
                        <label className="text-sm text-gray-600 block mb-2">
                            {t("profile.organisation")}
                        </label>
                        <div className="flex gap-2">
                            <Input
                                type="text"
                                value={organisation}
                                onChange={(e) =>
                                    setOrganisation(e.target.value)
                                }
                                placeholder={t("profile.organisationPlaceholder")}
                                className="flex-1"
                            />
                            <Button
                                onClick={handleSaveOrganisation}
                                disabled={
                                    isSavingOrg ||
                                    organisation.trim() ===
                                        (profile?.organisation ?? "") ||
                                    orgSaved
                                }
                                className="min-w-[80px] transition-all bg-black hover:bg-gray-900 text-white"
                            >
                                {isSavingOrg ? (
                                    tc("saving")
                                ) : orgSaved ? (
                                    <>
                                        <Check className="h-4 w-3" />
                                        {tc("saved")}
                                    </>
                                ) : (
                                    tc("save")
                                )}
                            </Button>
                        </div>
                    </div>
                    <div>
                        <label className="text-sm text-gray-600 block mb-2">
                            {t("profile.email")}
                        </label>
                        <p className="text-base">{user?.email}</p>
                    </div>
                </div>
            </div>

            {/* Plan */}
            <div className="py-6">
                <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-2xl font-medium font-serif">
                        {t("plan.title")}
                    </h2>
                </div>
                <div>
                    <p className="text-base font-medium text-gray-500 capitalize">
                        {profile?.tier || t("plan.free")}
                    </p>
                </div>
            </div>

            {/* Actions */}
            <div className="py-6">
                <h2 className="text-2xl font-medium font-serif mb-4">
                    {t("actions.title")}
                </h2>
                <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="w-full sm:w-auto"
                >
                    <LogOut className="h-4 w-4 mr-2" />
                    {t("actions.signOut")}
                </Button>
            </div>

            {/* Danger Zone */}
            <div className="py-6">
                <h2 className="text-2xl font-medium font-serif mb-1 text-red-600">
                    {t("danger.title")}
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                    {t("danger.description")}
                </p>
                {deleteConfirm ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3 max-w-sm">
                        <p className="text-sm font-medium text-red-700">
                            {t("danger.confirmMessage")}
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setDeleteConfirm(false)}
                                disabled={isDeleting}
                                className="text-sm"
                            >
                                {tc("cancel")}
                            </Button>
                            <Button
                                onClick={handleDeleteAccount}
                                disabled={isDeleting}
                                className="text-sm bg-red-600 hover:bg-red-700 text-white"
                            >
                                {isDeleting ? t("danger.deleting") : t("danger.deleteAccount")}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Button
                        variant="outline"
                        onClick={() => setDeleteConfirm(true)}
                        className="w-full sm:w-auto border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                        {t("danger.deleteAccount")}
                    </Button>
                )}
            </div>
        </div>
    );
}
