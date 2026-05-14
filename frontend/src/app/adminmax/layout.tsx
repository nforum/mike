import type { Metadata } from "next";

// Standalone admin shell. We deliberately do NOT include the user
// AppHeader / sidebar / Providers context here — /adminmax must stay
// usable when no end-user is signed in, and it must look visually
// distinct from the main product so admins never confuse the two.

export const metadata: Metadata = {
    title: "AdminMax · Max",
    robots: { index: false, follow: false },
};

export default function AdminMaxLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
        </div>
    );
}
