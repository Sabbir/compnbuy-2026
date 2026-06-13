# ── Base image — official Puppeteer image with Chrome pre-installed ──────────
# This image includes Node.js 20 + Google Chrome stable.
# No need to install Chrome separately or set PUPPETEER_EXECUTABLE_PATH.
FROM ghcr.io/puppeteer/puppeteer:23.0.0

# ── Set working directory ─────────────────────────────────────────────────────
WORKDIR /app

# ── Copy package files first (for layer caching) ─────────────────────────────
COPY package*.json ./

# ── Install dependencies ──────────────────────────────────────────────────────
# Skip Chromium download — we use the Chrome from the base image instead
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci --omit=dev

# ── Copy application source ───────────────────────────────────────────────────
COPY . .

# ── Expose port ───────────────────────────────────────────────────────────────
EXPOSE 3000

# ── Start server ──────────────────────────────────────────────────────────────
CMD ["node", "server.js"]
