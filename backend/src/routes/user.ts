import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { from } from "../lib/dbShim";
import { getPool } from "../lib/db";
import { encryptApiKey, maskApiKey } from "../lib/crypto";

export const userRouter = Router();

const API_KEY_FIELDS = ["claude_api_key", "gemini_api_key", "openai_api_key"] as const;

// GET /user/profile
userRouter.get("/profile", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const { data, error } = await from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    // Return default profile if none exists
    return res.json({
      display_name: null,
      organisation: null,
      message_credits_used: 0,
      credits_reset_date: new Date(Date.now() + 30 * 86400000).toISOString(),
      tier: "Free",
      tabular_model: "gemini-3-flash-preview",
      claude_api_key: null,
      gemini_api_key: null,
      openai_api_key: null,
    });
  }

  // Mask API keys — never send full keys to the browser
  const safe = { ...data };
  for (const field of API_KEY_FIELDS) {
    safe[field] = maskApiKey(data[field]);
  }
  res.json(safe);
});

// PATCH /user/profile
userRouter.patch("/profile", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const allowed = [
    "display_name", "organisation", "tabular_model",
    "claude_api_key", "gemini_api_key", "openai_api_key",
    "message_credits_used", "credits_reset_date",
  ];
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
