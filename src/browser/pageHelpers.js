/**
 * pageHelpers.js
 * Shared navigation & DOM utilities used by all scrapers.
 */

const { newPage } = require("./browserManager");

const PAGE_TIMEOUT = parseInt(process.env.PAGE_TIMEOUT) || 30000;
const WAIT_AFTER_LOAD = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Navigate to a URL with retry logic.
 */
async function navigateTo(page, url, attempt = 1, maxRetries = 2) {
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: PAGE_TIMEOUT });
    await sleep(WAIT_AFTER_LOAD);
  } catch (err) {
    if (attempt <= maxRetries) {
      await sleep(3000);
      return navigateTo(page, url, attempt + 1, maxRetries);
    }
    throw new Error(`Navigation failed for ${url}: ${err.message}`);
  }
}

/**
 * Scroll to bottom so lazy-loaded content renders.
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const dist = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, dist);
        total += dist;
        if (total >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });
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
