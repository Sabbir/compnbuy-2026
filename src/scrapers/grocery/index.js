/**
 * index.js  (src/scrapers/grocery)
 * Unified entry point for all Grocery scrapers.
 *
 * Sources:
 *   chaldal      → chaldal.com         (React SPA)
 *   thebasketbd  → thebasketbd.com     (Magento 2)
 *   aamaderbazar → aamaderbazar.com    (WooCommerce)
 *
 * MeenaBazaar has been removed and replaced with Aamader Bazar.
 */

const { scrapeChaldal,       searchChaldal }                        = require("./chaldalScraper");
const { scrapeBasket,        searchBasket }                         = require("./basketScraper");
const { scrapeAamaderBazar,  searchAamaderBazar,
        getAamaderBazarCategories }                                  = require("./aamaderBazarScraper");

const SOURCE_DEFAULTS = {
  chaldal:      "https://chaldal.com",
  thebasketbd:  "https://www.thebasketbd.com",
  aamaderbazar: "https://aamaderbazar.com/product-category/cooking-essentials/",
};

const SCRAPERS = {
  chaldal:      scrapeChaldal,
  thebasketbd:  scrapeBasket,
  aamaderbazar: scrapeAamaderBazar,
};

const SEARCH_FNS = {
  chaldal:      searchChaldal,
  thebasketbd:  searchBasket,
  aamaderbazar: searchAamaderBazar,
};

const CATEGORY_FETCHERS = {
  aamaderbazar: getAamaderBazarCategories,
};

async function scrapeGrocerySource(source, url, pages = 1) {
  const scraper = SCRAPERS[source];
  if (!scraper) throw new Error(
    `Unknown grocery source "${source}". Valid: ${Object.keys(SCRAPERS).join(", ")}`
  );
  return scraper(url || SOURCE_DEFAULTS[source], pages);
}

async function scrapeAllGrocery(pages = 1) {
  const entries = Object.entries(SCRAPERS);
  const settled = await Promise.allSettled(
    entries.map(([source]) => scrapeGrocerySource(source, undefined, pages))
  );
  const products = [], errors = [];
  settled.forEach((result, i) => {
    const source = entries[i][0];
    if (result.status === "fulfilled") products.push(...result.value);
    else errors.push({ source, error: result.reason?.message || "Unknown error" });
  });
  return { products, errors };
}

async function searchGrocerySource(keyword, source, pages = 1) {
  const fn = SEARCH_FNS[source];
  if (!fn) throw new Error(
    `Unknown grocery source "${source}". Valid: ${Object.keys(SEARCH_FNS).join(", ")}`
  );
  return fn(keyword, pages);
}

async function searchAllGrocery(keyword, pages = 1) {
  const entries = Object.entries(SEARCH_FNS);
  const settled = await Promise.allSettled(
    entries.map(([, fn]) => fn(keyword, pages))
  );
  const products = [], errors = [];
  settled.forEach((result, i) => {
    const source = entries[i][0];
    if (result.status === "fulfilled") products.push(...result.value);
    else errors.push({ source, error: result.reason?.message || "Unknown error" });
  });
  return { products, errors };
}

async function getMeenaCategories() {
  return getAamaderBazarCategories();
}

module.exports = {
  scrapeGrocerySource,
  scrapeAllGrocery,
  searchGrocerySource,
  searchAllGrocery,
  getMeenaCategories,   // kept for backward compatibility with routes
  SOURCES: Object.keys(SCRAPERS),
  SOURCE_DEFAULTS,
};
