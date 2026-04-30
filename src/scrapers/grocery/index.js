/**
 * groceryIndex.js
 * Unified entry point for all Grocery scrapers.
 *
 * Supported sources:
 *   - chaldal       → chaldal.com
 *   - thebasketbd   → thebasketbd.com
 *   - meenabazaar   → meenabazaronline.com
 *   - all           → scrape / search all three in parallel
 */

const { scrapeChaldal, searchChaldal }              = require("./chaldalScraper");
const { scrapeBasket,  searchBasket }               = require("./basketScraper");
const { scrapeMeena,   getMeenaCategories, searchMeena } = require("./meenaScraper");

// Default entry URLs per source
const SOURCE_DEFAULTS = {
  chaldal:     "https://chaldal.com",
  thebasketbd: "https://www.thebasketbd.com/",
  meenabazaar: "https://meenabazaronline.com/",
};

const SCRAPERS = {
  chaldal:     scrapeChaldal,
  thebasketbd: scrapeBasket,
  meenabazaar: scrapeMeena,
};

const SEARCH_FNS = {
  chaldal:     searchChaldal,
  thebasketbd: searchBasket,
  meenabazaar: searchMeena,
};

// ─── Browse (existing) ────────────────────────────────────────────────────────

/**
 * Scrape a single grocery source.
 * @param {"chaldal"|"thebasketbd"|"meenabazaar"} source
 * @param {string}  url    optional override URL
 * @param {number}  pages
 */
async function scrapeGrocerySource(source, url, pages = 1) {
  const scraper = SCRAPERS[source];
  if (!scraper) {
    throw new Error(
      `Unknown grocery source "${source}". Valid: ${Object.keys(SCRAPERS).join(", ")}`
    );
  }
  return scraper(url || SOURCE_DEFAULTS[source], pages);
}

/**
 * Scrape all three grocery sources in parallel.
 * @param {number} pages   pages per source
 */
async function scrapeAllGrocery(pages = 1) {
  const entries = Object.entries(SCRAPERS);

  const settled = await Promise.allSettled(
    entries.map(([source]) => scrapeGrocerySource(source, undefined, pages))
  );

  const combined = [];
  const errors   = [];

  settled.forEach((result, i) => {
    const source = entries[i][0];
    if (result.status === "fulfilled") {
      combined.push(...result.value);
    } else {
      errors.push({ source, error: result.reason?.message || "Unknown error" });
    }
  });

  return { products: combined, errors };
}

// ─── Search (new) ─────────────────────────────────────────────────────────────

/**
 * Search a single grocery source by keyword.
 * @param {string} keyword
 * @param {"chaldal"|"thebasketbd"|"meenabazaar"} source
 * @param {number} pages
 */
async function searchGrocerySource(keyword, source, pages = 1) {
  const fn = SEARCH_FNS[source];
  if (!fn) {
    throw new Error(
      `Unknown grocery source "${source}". Valid: ${Object.keys(SEARCH_FNS).join(", ")}`
    );
  }
  return fn(keyword, pages);
}

/**
 * Search all three grocery sources in parallel.
 * @param {string} keyword
 * @param {number} pages   pages per source
 */
async function searchAllGrocery(keyword, pages = 1) {
  const entries = Object.entries(SEARCH_FNS);

  const settled = await Promise.allSettled(
    entries.map(([, fn]) => fn(keyword, pages))
  );

  const products = [];
  const errors   = [];

  settled.forEach((result, i) => {
    const source = entries[i][0];
    if (result.status === "fulfilled") {
      products.push(...result.value);
    } else {
      errors.push({ source, error: result.reason?.message || "Unknown error" });
    }
  });

  return { products, errors };
}

module.exports = {
  scrapeGrocerySource,
  scrapeAllGrocery,
  searchGrocerySource,
  searchAllGrocery,
  getMeenaCategories,
  SOURCES:      Object.keys(SCRAPERS),
  SOURCE_DEFAULTS,
};
