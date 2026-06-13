/**
 * browserManager.js
 * Singleton that owns one persistent Puppeteer browser instance.
 * All scrapers borrow pages from it; the server shuts it down on exit.
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─── Resolve Chrome executable ────────────────────────────────────────────────

function resolveChromePath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    // ── Puppeteer Docker image (ghcr.io/puppeteer/puppeteer) ──────────────
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    // ── Standard Linux paths ──────────────────────────────────────────────
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean);

  // Search Puppeteer cache (~/.cache/puppeteer/chrome)
  const cacheRoot = path.join(
    process.env.HOME || "/root",
    ".cache", "puppeteer", "chrome"
  );
  if (fs.existsSync(cacheRoot)) {
    fs.readdirSync(cacheRoot).forEach((v) => {
      const p = path.join(cacheRoot, v, "chrome-linux64", "chrome");
      if (fs.existsSync(p)) candidates.unshift(p);
    });
  }

  const found = candidates.find((p) => fs.existsSync(p)) || null;
  if (found) console.log(`[Browser] Chrome found at: ${found}`);
  else        console.warn("[Browser] Chrome not found in any known path");
  return found;
}

// ─── Singleton State ──────────────────────────────────────────────────────────

let _browser = null;

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;

  const executablePath = resolveChromePath();
  _browser = await puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
      // Required on Render free tier (512MB RAM) — runs Chrome in one process
      "--single-process",
      "--no-zygote",
    ],
    defaultViewport: { width: 1366, height: 768 },
  });

  _browser.on("disconnected", () => { _browser = null; });
  console.log(`[Browser] Launched: ${await _browser.version()}`);
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
    console.log("[Browser] Closed.");
  }
}

/**
 * Creates a new stealth page from the shared browser.
 */
async function newPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
  });

  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  return page;
}

module.exports = { getBrowser, closeBrowser, newPage };
