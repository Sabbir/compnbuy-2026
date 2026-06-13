# ── Base image — official Puppeteer image with Chrome pre-installed ──────────
# This image includes Node.js 20 + Google Chrome stable.
FROM ghcr.io/puppeteer/puppeteer:23.0.0

# ── Set working directory ─────────────────────────────────────────────────────
WORKDIR /app

# ── Copy package files ────────────────────────────────────────────────────────
COPY package*.json ./

# ── Install dependencies ──────────────────────────────────────────────────────
# Skip Chromium download — we use Chrome from the base image
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Use npm install instead of npm ci (ci requires package-lock.json)
RUN npm install --omit=dev --no-audit --no-fund

# ── Copy application source ───────────────────────────────────────────────────
COPY . .

# ── Expose port ───────────────────────────────────────────────────────────────
EXPOSE 3000

# ── Start server ──────────────────────────────────────────────────────────────
CMD ["node", "server.js"]
