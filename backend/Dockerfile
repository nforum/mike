# ────────────────────────────────────────────────────────────────
#  MikeOSS Backend — Cloud Run Dockerfile
#
#  Multi-stage build:
#    1. builder  — install deps + tsc compile
#    2. runner   — slim runtime with LibreOffice for docx→pdf
# ────────────────────────────────────────────────────────────────

# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ── Stage 2: Runtime ────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

# LibreOffice headless for docx/doc → PDF conversion
RUN apt-get update && \
    apt-get install -y --no-install-recommends libreoffice-writer && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Compiled JS from builder stage
COPY --from=builder /app/dist ./dist

# Cloud Run injects PORT env var (default 8080)
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

# Non-root for security
RUN groupadd -r mike && useradd -r -g mike mike
USER mike

CMD ["node", "dist/index.js"]
