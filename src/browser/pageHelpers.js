/**
 * pageHelpers.js
 * Shared navigation & DOM utilities used by all scrapers.
 */

const { newPage } = require("./browserManager");

// Per-page navigation timeout — env override supported
const PAGE_TIMEOUT    = parseInt(process.env.PAGE_TIMEOUT) || 15000;
const WAIT_AFTER_LOAD = 2500; // ms to let React finish rendering product cards

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Navigate to a URL. One attempt only — no retries.
 * Uses domcontentloaded (fast) then waits for React to render product cards.
 */
async function navigateTo(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
    // Give React/JS frameworks time to hydrate and render product cards.
    // 800ms was too short — cards (and their img tags) hadn't appeared yet,
    // so scrolling had nothing to trigger lazy-load on.
    await sleep(WAIT_AFTER_LOAD);
  } catch (err) {
    const e = new Error(`Navigation failed for ${url}: ${err.message}`);
    e.code   = err.message.includes("timeout") ? "NAV_TIMEOUT" : "NAV_ERROR";
    throw e;
  }
}

/**
 * Scroll page to bottom in slow steps so lazy-loaders fire,
 * then force-copy any remaining data-src → src for headless environments
 * where IntersectionObserver may not fire without a real paint cycle.
 */
async function autoScroll(page) {
  // Step 1: scroll slowly — 200px every 300ms gives React lazy-loaders time
  // to fire between steps (faster scroll = observer misses images)
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const dist  = 200;
      const timer = setInterval(() => {
        window.scrollBy(0, dist);
        total += dist;
        if (total >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });

  // Step 2: wait for lazy-load callbacks to complete
  await sleep(1500);

  // Step 3: force-copy all lazy image attrs → src
  // In headless Chromium, IntersectionObserver may not fire for off-screen
  // elements. This ensures every img gets its real URL regardless.
  await page.evaluate(() => {
    const LAZY_ATTRS = ["data-src", "data-lazy", "data-original", "data-lazy-src",
                        "data-lazyload", "data-load-src", "data-echo"];
    document.querySelectorAll("img").forEach((img) => {
      // Skip already-loaded real images
      const currentSrc = img.getAttribute("src") || "";
      if (currentSrc && !currentSrc.startsWith("data:")) return;

      // Find the first non-empty lazy attr
      for (const attr of LAZY_ATTRS) {
        const val = img.getAttribute(attr);
        if (val && !val.startsWith("data:")) {
          img.setAttribute("src", val);
          break;
        }
      }
    });
  });

  // Step 4: scroll back to top so all above-fold images also load
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(800);
}

/**
 * Create a page, navigate, scroll, run extractor fn, then close the page.
 */
async function withPage(url, extractFn) {
  const page = await newPage();
  try {
    await navigateTo(page, url);
    await autoScroll(page);
    return await extractFn(page);
  } finally {
    await page.close();
  }
}

module.exports = { navigateTo, autoScroll, withPage, sleep };
