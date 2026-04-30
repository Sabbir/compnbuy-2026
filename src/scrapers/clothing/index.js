/**
 * index.js  (src/scrapers/clothing)
 * Unified entry point for all Clothing scrapers.
 */

const { scrapeBlucheez, getBlucheezCollections, searchBlucheez } = require("./blucheezScraper");
const { scrapeFabrilife, getFabrilifeCategories, searchFabrilife } = require("./fabrilifeScraper");
const { scrapeTwelve,   getTwelveCategories,    searchTwelve }   = require("./twelveScraper");

const SOURCE_DEFAULTS = {
  blucheez:  "https://blucheez.fashion/collections/all",
  fabrilife: "https://fabrilife.com/products",
  twelvebd:  "https://twelvebd.com/shop",
};

const SCRAPERS = {
  blucheez:  scrapeBlucheez,
  fabrilife: scrapeFabrilife,
  twelvebd:  scrapeTwelve,
};

const SEARCH_FNS = {
  blucheez:  searchBlucheez,
  fabrilife: searchFabrilife,
  twelvebd:  searchTwelve,
};

const CATEGORY_FETCHERS = {
  blucheez:  getBlucheezCollections,
  fabrilife: getFabrilifeCategories,
  twelvebd:  getTwelveCategories,
};

async function scrapeClothingSource(source, url, pages = 1) {
  const scraper = SCRAPERS[source];
  if (!scraper) throw new Error(`Unknown clothing source "${source}". Valid: ${Object.keys(SCRAPERS).join(", ")}`);
  return scraper(url || SOURCE_DEFAULTS[source], pages);
}

async function scrapeAllClothing(pages = 1) {
  const entries = Object.entries(SCRAPERS);
  const settled = await Promise.allSettled(
    entries.map(([source]) => scrapeClothingSource(source, undefined, pages))
  );
  const products = [], errors = [];
  settled.forEach((result, i) => {
    const source = entries[i][0];
    if (result.status === "fulfilled") products.push(...result.value);
    else errors.push({ source, error: result.reason?.message || "Unknown error" });
  });
  return { products, errors };
}

async function searchClothingSource(keyword, source, pages = 1) {
  const fn = SEARCH_FNS[source];
  if (!fn) throw new Error(`Unknown clothing source "${source}". Valid: ${Object.keys(SEARCH_FNS).join(", ")}`);
  return fn(keyword, pages);
}

async function searchAllClothing(keyword, pages = 1) {
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

async function getClothingCategories(source) {
  const fetcher = CATEGORY_FETCHERS[source];
  if (!fetcher) throw new Error(`No category fetcher for "${source}". Valid: ${Object.keys(CATEGORY_FETCHERS).join(", ")}`);
  return fetcher();
}

module.exports = {
  scrapeClothingSource,
  scrapeAllClothing,
  searchClothingSource,
  searchAllClothing,
  getClothingCategories,
  SOURCES:        Object.keys(SCRAPERS),
  SOURCE_DEFAULTS,
};
