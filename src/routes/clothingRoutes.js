/**
 * clothingRoutes.js
 * REST endpoints for the Clothing category.
 *
 * All browse endpoints now accept an optional ?q= param.
 * When ?q= is provided the endpoint runs a keyword search instead of browsing.
 *
 * GET  /api/clothing/sources
 * GET  /api/clothing/all?pages=<n>&q=<keyword>
 * GET  /api/clothing/search?q=<keyword>&source=<s>&pages=<n>
 * GET  /api/clothing/:source?url=&pages=&q=<keyword>
 * GET  /api/clothing/:source/categories
 */

const { Router } = require("express");
const {
  scrapeClothingSource,
  scrapeAllClothing,
  searchClothingSource,
  searchAllClothing,
  getClothingCategories,
  SOURCES,
  SOURCE_DEFAULTS,
} = require("../scrapers/clothing/index");
const { asyncHandler }         = require("../middleware/errorHandler");
const { success, badRequest }  = require("../utils/response");
const { parsePages }           = require("../utils/validators");
const { cacheKey, getOrFetch } = require("../utils/cache");

const router = Router();

const ALLOWED_DOMAINS = {
  blucheez:  "blucheez.fashion",
  fabrilife: "fabrilife.com",
  twelvebd:  "twelvebd.com",
};

function isAllowedUrl(source, url) {
  try { return new URL(url).hostname.endsWith(ALLOWED_DOMAINS[source]); }
  catch { return false; }
}

// ─── GET /api/clothing/sources ────────────────────────────────────────────────
router.get("/sources", (req, res) => {
  return success(res, {
    category: "Clothing",
    sources:  SOURCES.map((s) => ({
      source:     s,
      domain:     ALLOWED_DOMAINS[s],
      defaultUrl: SOURCE_DEFAULTS[s],
      searchable: true,
    })),
  });
});

// ─── GET /api/clothing/all?pages=&q= ─────────────────────────────────────────
router.get(
  "/all",
  asyncHandler(async (req, res) => {
    const pages   = parsePages(req.query.pages);
    const keyword = req.query.q?.trim() || "";

    if (keyword) {
      // keyword search across all clothing sources
      const key = cacheKey("clothing:search:all", { q: keyword, pages });
      let fromCache = true;
      const result  = await getOrFetch(key, () => {
        fromCache = false;
        return searchAllClothing(keyword, pages);
      });
      return success(res, result.products, {
        category: "Clothing", sources: SOURCES,
        query: keyword, pages, count: result.products.length,
        errors: result.errors.length > 0 ? result.errors : undefined,
        cached: fromCache,
      });
    }

    // browse all
    const key = cacheKey("clothing:all", { pages });
    let fromCache = true;
    const result  = await getOrFetch(key, () => {
      fromCache = false;
      return scrapeAllClothing(pages);
    });
    return success(res, result.products, {
      category: "Clothing", sources: SOURCES, pages,
      count: result.products.length,
      errors: result.errors.length > 0 ? result.errors : undefined,
      cached: fromCache,
    });
  })
);

// ─── GET /api/clothing/search?q=&source=&pages= ───────────────────────────────
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const keyword = req.query.q?.trim() || "";
    const source  = req.query.source || "all";

    if (!keyword) return badRequest(res, 'Query parameter "q" is required');

    const validSources = ["all", ...SOURCES];
    if (!validSources.includes(source))
      return badRequest(res, `"source" must be one of: ${validSources.join(", ")}`);

    const pages = parsePages(req.query.pages);
    const key   = cacheKey("clothing:search", { q: keyword, source, pages });

    let fromCache = true;
    let result;

    if (source === "all") {
      result = await getOrFetch(key, () => {
        fromCache = false;
        return searchAllClothing(keyword, pages);
      });
    } else {
      const products = await getOrFetch(key, () => {
        fromCache = false;
        return searchClothingSource(keyword, source, pages);
      });
      result = { products, errors: [] };
    }

    return success(res, result.products, {
      category: "Clothing", query: keyword, source, pages,
      count: result.products.length,
      errors: result.errors?.length > 0 ? result.errors : undefined,
      cached: fromCache,
    });
  })
);

// ─── GET /api/clothing/:source/categories ─────────────────────────────────────
router.get(
  "/:source/categories",
  asyncHandler(async (req, res) => {
    const { source } = req.params;
    if (!SOURCES.includes(source))
      return badRequest(res, `Unknown source "${source}". Valid: ${SOURCES.join(", ")}`);

    const key = cacheKey(`clothing:${source}:cats`, {});
    let fromCache = true;
    const cats    = await getOrFetch(key, () => {
      fromCache = false;
      return getClothingCategories(source);
    });
    return success(res, cats, { source, count: cats.length, cached: fromCache });
  })
);

// ─── GET /api/clothing/:source?url=&pages=&q= ─────────────────────────────────
router.get(
  "/:source",
  asyncHandler(async (req, res) => {
    const { source } = req.params;
    if (!SOURCES.includes(source))
      return badRequest(res, `Unknown source "${source}". Valid: ${SOURCES.join(", ")}`);

    const keyword = req.query.q?.trim() || "";
    const pages   = parsePages(req.query.pages);

    // If ?q= provided → search this source
    if (keyword) {
      const key = cacheKey(`clothing:search:${source}`, { q: keyword, pages });
      let fromCache = true;
      const products = await getOrFetch(key, () => {
        fromCache = false;
        return searchClothingSource(keyword, source, pages);
      });
      return success(res, products, {
        source, category: "Clothing", query: keyword, pages,
        count: products.length, cached: fromCache,
      });
    }

    // browse
    const { url } = req.query;
    if (url && !isAllowedUrl(source, url))
      return badRequest(res, `URL must be on the ${ALLOWED_DOMAINS[source]} domain for source "${source}"`);

    const targetUrl = url || SOURCE_DEFAULTS[source];
    const key       = cacheKey(`clothing:${source}`, { url: targetUrl, pages });
    let fromCache   = true;
    const products  = await getOrFetch(key, () => {
      fromCache = false;
      return scrapeClothingSource(source, targetUrl, pages);
    });
    return success(res, products, {
      source, category: "Clothing", url: targetUrl, pages,
      count: products.length, cached: fromCache,
    });
  })
);

module.exports = router;
