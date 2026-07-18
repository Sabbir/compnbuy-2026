/**
 * listingScraper.js
 * Scrapes product cards from Daraz search results and category pages.
 * No retries — if a page times out, it's skipped and results so far are returned.
 */

const { newPage } = require("../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../browser/pageHelpers");

const BASE_URL = "https://www.daraz.com.bd";
const DELAY    = parseInt(process.env.PAGE_DELAY) || 1000; // reduced from 2000

// ─── DOM Extractor (runs inside Chromium) ─────────────────────────────────────

function extractCards() {
  const cards = document.querySelectorAll(
    '[data-qa-locator="product-item"], .c2prKC, ._17mcb, .gridItem--Yz3Ii'
  );

  const cleanPrice = (raw) => {
    const n = parseFloat((raw || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  return Array.from(cards)
    .map((card) => {
      const titleEl =
        card.querySelector('[class*="title"] a[title]') ||
        card.querySelector("a[title]") ||
        card.querySelector('[class*="title"]');
      const title = titleEl?.getAttribute("title") || titleEl?.textContent?.trim() || "";
      if (!title) return null;

      const priceRaw  = card.querySelector('[class*="price"] span, .aBrP0 span')?.textContent?.trim() || "";
      const origRaw   = card.querySelector('[class*="original"] span, .IcOsH span, [class*="del"]')?.textContent?.trim() || "";
      const discount  = card.querySelector('[class*="discount"], .WNoq3, [class*="Discount"]')?.textContent?.trim() || null;
      const rating    = card.querySelector('[class*="rating"] span, [class*="Rating"] span')?.textContent?.trim() || null;
      const reviewRaw = card.querySelector('[class*="review"], [class*="Review"]')?.textContent?.trim() || "";
      const img = card.querySelector("img");
      // Daraz uses various lazy-load attributes depending on their React version.
      // Always prefer lazy attrs over src (src holds a base64 placeholder until
      // the image is actually in viewport). autoScroll force-copies these to src,
      // but we read the attrs directly as a belt-and-suspenders approach.
      const rawSrc = img?.getAttribute("src") || "";
      const imageUrl =
        img?.getAttribute("data-src")       ||
        img?.getAttribute("data-lazy")      ||
        img?.getAttribute("data-original")  ||
        img?.getAttribute("data-lazy-src")  ||
        img?.getAttribute("data-lazyload")  ||
        img?.getAttribute("data-echo")      ||
        img?.getAttribute("data-load-src")  ||
        (rawSrc.startsWith("data:") ? "" : rawSrc);
      const href      = card.querySelector("a")?.getAttribute("href") || "";
      const reviewMatch = reviewRaw.match(/\d+/);

      return {
        title,
        price:         cleanPrice(priceRaw),
        originalPrice: cleanPrice(origRaw),
        discount,
        rating,
        reviewCount:   reviewMatch ? parseInt(reviewMatch[0]) : null,
        imageUrl:      (imageUrl || "").startsWith("//") ? "https:" + imageUrl : (imageUrl || ""),
        // BASE_URL cannot be referenced here — this fn runs inside the browser
        productUrl:    href.startsWith("http") ? href : "https://www.daraz.com.bd" + href,
      };
    })
    .filter(Boolean);
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function scrapeSearch(keyword, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    for (let p = 1; p <= pages; p++) {
      const url = `${BASE_URL}/catalog/?q=${encodeURIComponent(keyword)}&page=${p}`;
      try {
        console.log(url)
        await navigateTo(page, url);
        await autoScroll(page);
        const products = await page.evaluate(extractCards);
        results.push(...products);
      } catch (err) {
        // One failed page → log it, stop paging, return what we have
        console.warn(`[daraz] scrapeSearch p${p} skipped (${err.code || "ERR"}): ${err.message}`);
        break;
      }
      if (p < pages) await sleep(DELAY);
    }
  } finally {
    await page.close().catch(() => {});
  }
  console.log(results)
  return results;
}

async function scrapeCategory(categoryUrl, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    for (let p = 1; p <= pages; p++) {
      const url = p === 1 ? categoryUrl : `${categoryUrl}?page=${p}`;
      try {
        await navigateTo(page, url);
        await autoScroll(page);
        const products = await page.evaluate(extractCards);
        results.push(...products);
      } catch (err) {
        console.warn(`[daraz] scrapeCategory p${p} skipped (${err.code || "ERR"}): ${err.message}`);
        break;
      }
      if (p < pages) await sleep(DELAY);
    }
  } finally {
    await page.close().catch(() => {});
  }

  return results;
}

module.exports = { scrapeSearch, scrapeCategory };
