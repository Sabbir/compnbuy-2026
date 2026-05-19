/**
 * index.js  (src/scrapers/electronics)
 * Unified entry point for all Electronics scrapers.
 *
 * Supported sources:
 *   startech    → startech.com.bd   (Custom PHP)
 *   ryans       → ryans.com         (Custom PHP / Laravel)
 *   techlandbd  → techlandbd.com    (Laravel + Livewire)  ← replaces vertech
 *   all         → all three in parallel
 */

const { scrapeStarTech,    searchStarTech,    getStarTechCategories }    = require("./startechScraper");
const { scrapeRyans,       searchRyans,       getRyansCategories }        = require("./ryansScraper");
const { scrapeTechlandbd,  searchTechlandbd,  getTechlandbdCategories }   = require("./techlandbdScraper");

const SOURCE_DEFAULTS = {
  startech:   "https://www.startech.com.bd/laptop-notebook",
  ryans:      "https://www.ryans.com/category/desktop-component-mouse",
  techlandbd: "https://www.techlandbd.com/search/advance/product/result/laptop",
};

const SCRAPERS = {
  startech:   scrapeStarTech,
  ryans:      scrapeRyans,
  techlandbd: scrapeTechlandbd,
};

const SEARCH_FNS = {
  startech:   searchStarTech,
  ryans:      searchRyans,
  techlandbd: searchTechlandbd,
};

const CATEGORY_FETCHERS = {
  startech:   getStarTechCategories,
  ryans:      getRyansCategories,
  techlandbd: getTechlandbdCategories,
};

/**
 * Scrape a single electronics source.
 * @param {"startech"|"ryans"|"techlandbd"} source
 * @param {string} url    optional URL override
 * @param {number} pages
 */
async function scrapeElectronicsSource(source, url, pages = 1) {
  const scraper = SCRAPERS[source];
  if (!scraper) {
    throw new Error(
      `Unknown electronics source "${source}". Valid: ${Object.keys(SCRAPERS).join(", ")}`
    );
  }
  return scraper(url || SOURCE_DEFAULTS[source], pages);
}

/**
 * Search across one or all electronics sources.
 * @param {string} keyword
 * @param {"startech"|"ryans"|"techlandbd"|"all"} source
 * @param {number} pages
 */
async function searchElectronics(keyword, source = "all", pages = 1) {
  if (source === "all") {
    const settled = await Promise.allSettled(
      Object.entries(SEARCH_FNS).map(([, fn]) => fn(keyword, pages))
    );
    const products = [];
    const errors   = [];
    settled.forEach((r, i) => {
      const src = Object.keys(SEARCH_FNS)[i];
      if (r.status === "fulfilled") products.push(...r.value);
      else errors.push({ source: src, error: r.reason?.message });
    });
    return { products, errors };
  }

  const fn = SEARCH_FNS[source];
  if (!fn) throw new Error(`Search not supported for source "${source}"`);
  const products = await fn(keyword, pages);
  return { products, errors: [] };
}

/**
 * Scrape all three electronics sources in parallel.
 * @param {number} pages
 */
async function scrapeAllElectronics(pages = 1) {
  const entries = Object.entries(SCRAPERS);

  const settled = await Promise.allSettled(
    entries.map(([source]) => scrapeElectronicsSource(source, undefined, pages))
  );

  const products = [];
  const errors   = [];

  settled.forEach((result, i) => {
    const source = entries[i][0];
    if (result.status === "fulfilled") products.push(...result.value);
    else errors.push({ source, error: result.reason?.message || "Unknown error" });
  });

  return { products, errors };
}

/**
 * Get categories for a given source.
 */
async function getElectronicsCategories(source) {
  const fetcher = CATEGORY_FETCHERS[source];
  if (!fetcher) {
    throw new Error(
      `No category fetcher for "${source}". Valid: ${Object.keys(CATEGORY_FETCHERS).join(", ")}`
    );
  }
  return fetcher();
}

module.exports = {
  scrapeElectronicsSource,
  scrapeAllElectronics,
  searchElectronics,
  getElectronicsCategories,
  SOURCES:         Object.keys(SCRAPERS),
  SOURCE_DEFAULTS,
};
