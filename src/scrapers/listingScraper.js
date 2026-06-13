/**
 * listingScraper.js
 * Scrapes product cards from Daraz search results and category pages.
 */

const { newPage } = require("../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../browser/pageHelpers");

const BASE_URL = "https://www.daraz.com.bd";
const DELAY = parseInt(process.env.PAGE_DELAY) || 2000;

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
      const img       = card.querySelector("img");
      const imageUrl  = img?.getAttribute("src") || img?.getAttribute("data-src") || "";
      const href      = card.querySelector("a")?.getAttribute("href") || "";
      const reviewMatch = reviewRaw.match(/\d+/);

      return {
        title,
        price:         cleanPrice(priceRaw),
        originalPrice: cleanPrice(origRaw),
        discount,
        rating,
        reviewCount:   reviewMatch ? parseInt(reviewMatch[0]) : null,
        imageUrl:      imageUrl.startsWith("//") ? "https:" + imageUrl : imageUrl,
        productUrl:    href.startsWith("http") ? href : "https://www.daraz.com.bd" + href,
      };
    })
    .filter(Boolean);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape search results by keyword.
 * @param {string} keyword
 * @param {number} pages
 * @returns {Promise<object[]>}
 */
async function scrapeSearch(keyword, pages = 1) {
  const page = await newPage();
  const results = [];

  try {
    for (let p = 1; p <= pages; p++) {
      const url = `${BASE_URL}/catalog/?q=${encodeURIComponent(keyword)}&page=${p}`;
      await navigateTo(page, url);
      await autoScroll(page);
      const products = await page.evaluate(extractCards);
      results.push(...products);
      if (p < pages) await sleep(DELAY);
    }
  } finally {
    await page.close();
  }

  return results;
}

/**
 * Scrape a category listing page.
 * @param {string} categoryUrl
 * @param {number} pages
 * @returns {Promise<object[]>}
 */
async function scrapeCategory(categoryUrl, pages = 1) {
  const page = await newPage();
  const results = [];

  try {
    for (let p = 1; p <= pages; p++) {
      const url = p === 1 ? categoryUrl : `${categoryUrl}?page=${p}`;
      await navigateTo(page, url);
      await autoScroll(page);
      const products = await page.evaluate(extractCards);
      results.push(...products);
      if (p < pages) await sleep(DELAY);
    }
  } finally {
    await page.close();
  }

  return results;
}

module.exports = { scrapeSearch, scrapeCategory };
