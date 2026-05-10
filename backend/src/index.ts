import "dotenv/config";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import { closePool } from "./lib/db";
import { chatRouter } from "./routes/chat";
import { projectsRouter } from "./routes/projects";
import { projectChatRouter } from "./routes/projectChat";
import { documentsRouter } from "./routes/documents";
import { tabularRouter } from "./routes/tabular";
import { workflowsRouter } from "./routes/workflows";
import { userRouter } from "./routes/user";
import { downloadsRouter } from "./routes/downloads";
import { mcpServersRouter } from "./routes/mcpServers";
import { mcpOauthRouter } from "./routes/mcpOauth";

const app = express();
const PORT = process.env.PORT ?? 3001;

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://mike-frontend-516192556389.europe-west1.run.app",
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];

function isAllowedOrigin(origin: string | undefined | null): boolean {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

// Defense-in-depth: ensure ACAO is on every response, including ones the
// route never gets to write (early throws, hung handlers, etc). Without
// this, the browser blames CORS for what is actually a 5xx, hiding the
// real error in the network tab.
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (isAllowedOrigin(origin) && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, origin ?? true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "50mb" }));

app.use("/chat", chatRouter);
app.use("/projects", projectsRouter);
app.use("/projects/:projectId/chat", projectChatRouter);
app.use("/single-documents", documentsRouter);
app.use("/tabular-review", tabularRouter);
app.use("/workflows", workflowsRouter);
app.use("/user", userRouter);
app.use("/users", userRouter);
app.use("/download", downloadsRouter);
app.use("/user/mcp-servers", mcpServersRouter);
app.use("/mcp/oauth", mcpOauthRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Catch-all 404 — keeps unmatched paths inside Express so CORS headers
// (set by the middleware above) get attached, instead of letting Cloud
// Run's edge respond with a header-less default.
app.use((req, res) => {
  res.status(404).json({ detail: "Not found", path: req.path });
});

// Global error handler — converts unhandled route exceptions into a
// JSON 500 with CORS headers attached. Without this, an Express crash
// surfaces in the browser as a confusing CORS error.
app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[error-handler] ${req.method} ${req.path}:`,
      err instanceof Error ? err.stack ?? err.message : err,
    );
    if (res.headersSent) {
      // Stream already started; nothing left to do but kill the
      // connection — the browser will see a network error but at
      // least the server log captured the cause.
      res.end();
      return;
    }
    res.status(500).json({ detail: "Internal server error", error: message });
  },
);

// Catch async leaks that escape Express. Logging keeps Cloud Run's
// crash logs informative even when the route handler never awaits.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const server = app.listen(PORT, () => {
  console.log(`Mike backend running on port ${PORT}`);
});

// ── Graceful shutdown (Cloud Run sends SIGTERM) ─────────────
function shutdown(signal: string) {
  console.log(`[shutdown] Received ${signal}, closing server…`);
  server.close(async () => {
    await closePool();
    console.log("[shutdown] Clean exit");
    process.exit(0);
  });
  // Force exit after 10s if connections won't drain
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
