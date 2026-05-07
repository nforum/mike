import "dotenv/config";
import express from "express";
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

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
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
