import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { from } from "../lib/dbShim";
import { getPool } from "../lib/db";

export const userRouter = Router();

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
  res.json(data);
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
    if (key in req.body) updates[key] = req.body[key];
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

