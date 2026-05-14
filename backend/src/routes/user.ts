import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { from } from "../lib/dbShim";
import { getPool } from "../lib/db";
import { encryptApiKey, maskApiKey } from "../lib/crypto";

export const userRouter = Router();

const API_KEY_FIELDS = ["claude_api_key", "gemini_api_key", "openai_api_key", "mistral_api_key"] as const;

/**
 * Per-provider "is a server-side fallback key available?" map. Mirrors
 * the env-var fallback order used by `userSettings.ts` so the frontend
 * can show the user "we'll use a shared key — you don't need to enter
 * your own" affordance without ever leaking the key value itself.
 */
function serverKeyAvailability() {
    return {
        claude: !!(
            process.env.ANTHROPIC_API_KEY?.trim() ||
            process.env.CLAUDE_API_KEY?.trim()
        ),
        gemini: !!process.env.GEMINI_API_KEY?.trim(),
        openai: !!(
            process.env.OPENAI_API_KEY?.trim() ||
            process.env.VLLM_API_KEY?.trim()
        ),
        mistral: !!process.env.MISTRAL_API_KEY?.trim(),
    };
}

// GET /user/profile
userRouter.get("/profile", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { data, error } = await from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    // Return default profile if none exists
    return res.json({
      // Internal users.id (UUID). Surfaced explicitly so the web client
      // can compare against entity.user_id columns (chats.user_id,
      // documents.user_id, …) which all store this UUID — not the
      // WordPress user_id stored as the JWT `sub`. Without this the
      // frontend's owner-check pre-conditions silently mismatch on
      // every owned-resource action (rename/delete) and the user gets
      // a misleading "owner-only action" modal.
      id: userId,
      email: userEmail ?? null,
      display_name: null,
      organisation: null,
      message_credits_used: 0,
      credits_reset_date: new Date(Date.now() + 30 * 86400000).toISOString(),
      tier: "Free",
      tabular_model: "claude-sonnet-4-6",
      // Mirrors migration 113's column default. Highest-effort thinking
      // is the safest default for a legal AI tool — better to overspend
      // on a quick question than to under-think a hard one.
      reasoning_effort: "high",
      // Match frontend/src/i18n/request.ts default so a freshly-paired
      // Word add-in opens in the same language as a freshly-loaded web app.
      preferred_language: "hr",
      claude_api_key: null,
      gemini_api_key: null,
      openai_api_key: null,
      mistral_api_key: null,
      server_keys: serverKeyAvailability(),
    });
  }

  // Mask API keys — never send full keys to the browser
  const safe: Record<string, unknown> = { ...data };
  for (const field of API_KEY_FIELDS) {
    safe[field] = maskApiKey(data[field]);
  }
  // Always overlay the authenticated user's internal id + email so
  // the client never has to guess the format. user_profiles.user_id
  // already stores the same value, but keeping this explicit makes
  // the contract obvious to callers.
  safe.id = userId;
  if (userEmail && safe.email == null) safe.email = userEmail;
  // Boolean flags only — never the env-var values themselves. This is
  // what the Settings UI keys off to skip "please paste your key" for
  // providers the operator has wired up centrally (e.g. via Secret
  // Manager → BREVO_API_KEY style mounts).
  safe.server_keys = serverKeyAvailability();
  res.json(safe);
});

// PATCH /user/profile
userRouter.patch("/profile", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const allowed = [
    "display_name", "organisation", "tabular_model",
    "claude_api_key", "gemini_api_key", "openai_api_key", "mistral_api_key",
    "message_credits_used", "credits_reset_date",
    // Locale code (e.g. "en", "hr"). Validated below before persisting.
    "preferred_language",
    // Reasoning intensity for the main composer ("low" | "medium" |
    // "high"). Validated below; CHECK constraint in migration 113
    // would reject anything else but we'd rather drop early with a
    // clean log line than have pg raise a 23514.
    "reasoning_effort",
  ];
  const SUPPORTED_LOCALES = new Set(["en", "hr"]);
  const SUPPORTED_EFFORTS = new Set(["low", "medium", "high"]);
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in req.body) {
      let val = req.body[key];
      // Encrypt API keys before storing
      if (API_KEY_FIELDS.includes(key as any) && typeof val === "string" && val.trim()) {
        // Don't re-encrypt if the value is masked (user didn't change it)
        if (val.includes("•")) continue;
        val = encryptApiKey(val.trim());
      }
      // Drop unknown locales silently — clients should never send them
      // but a typo shouldn't poison the column with a value we can't
      // load messages for.
      if (key === "preferred_language") {
        if (typeof val !== "string" || !SUPPORTED_LOCALES.has(val)) continue;
      }
      if (key === "reasoning_effort") {
        if (typeof val !== "string" || !SUPPORTED_EFFORTS.has(val)) continue;
      }
      updates[key] = val;
    }
  }

  // Upsert: ensure profile row exists before update
  try {
    const pool = await getPool();
    const existing = await pool.query(
      'SELECT id FROM user_profiles WHERE user_id = $1',
      [userId],
    );
    if (existing.rows.length === 0) {
      await pool.query(
        'INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
        [userId],
      );
    }
  } catch (err: any) {
    return void res.status(500).json({ detail: err.message });
  }

  const { error } = await from("user_profiles")
    .update(updates)
    .eq("user_id", userId);
  if (error) return void res.status(500).json({ detail: error.message });
  res.json({ ok: true });
});

// POST /user/profile
userRouter.post("/profile", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { error } = await from("user_profiles")
    .upsert(
      { user_id: userId },
      { onConflict: "user_id" },
    );
  if (error) return void res.status(500).json({ detail: error.message });
  res.json({ ok: true });
});

// DELETE /user/account
userRouter.delete("/account", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  try {
    const pool = await getPool();
    // Delete user and all associated data (cascade handles FKs)
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});
