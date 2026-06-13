# ── Base image — official Puppeteer image with Chrome pre-installed ──────────
FROM ghcr.io/puppeteer/puppeteer:23.0.0

# ── Switch to root to set up directory permissions ───────────────────────────
USER root

# ── Create app directory with correct ownership ───────────────────────────────
# pptruser is the non-root user in the Puppeteer base image
RUN mkdir -p /app && chown -R pptruser:pptruser /app

# ── Set working directory ─────────────────────────────────────────────────────
WORKDIR /app

# ── Switch back to non-root user ──────────────────────────────────────────────
USER pptruser

# ── Copy package files ────────────────────────────────────────────────────────
COPY --chown=pptruser:pptruser package*.json ./

# ── Install dependencies ──────────────────────────────────────────────────────
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm install --omit=dev --no-audit --no-fund

# ── Copy application source ───────────────────────────────────────────────────
COPY --chown=pptruser:pptruser . .

# ── Expose port ───────────────────────────────────────────────────────────────
EXPOSE 3000

# ── Start server ──────────────────────────────────────────────────────────────
CMD ["node", "server.js"]
