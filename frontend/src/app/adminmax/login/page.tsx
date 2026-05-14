"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { adminLogin } from "../lib/adminApi";

export default function AdminMaxLoginPage() {
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!password) return;
        setSubmitting(true);
        setError(null);
        try {
            await adminLogin(password);
            router.replace("/adminmax");
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="flex min-h-[80vh] items-center justify-center">
            <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
                <h1 className="mb-1 font-serif text-2xl font-semibold tracking-tight">
                    AdminMax
                </h1>
                <p className="mb-6 text-sm text-slate-400">
                    Interni pristup nadzoru potrošnje. Unesite admin lozinku.
                </p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                            Lozinka
                        </span>
                        <input
                            type="password"
                            autoComplete="current-password"
                            autoFocus
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
                            disabled={submitting}
                        />
                    </label>
                    {error && (
                        <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                            {error}
                        </p>
                    )}
                    <button
                        type="submit"
                        disabled={submitting || !password}
                        className="w-full rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {submitting ? "Prijavljivanje…" : "Prijava"}
                    </button>
                </form>
            </div>
        </div>
    );
}
