/**
 * groceryRoutes.js
 * REST endpoints for the Grocery category.
 *
 * All browse endpoints now accept an optional ?q= param.
 * When ?q= is provided the endpoint runs a keyword search instead of browsing.
 *
 * GET  /api/grocery/sources
 * GET  /api/grocery/all?pages=<n>&q=<keyword>
 * GET  /api/grocery/search?q=<keyword>&source=<s>&pages=<n>
 * GET  /api/grocery/meenabazaar/categories
 * GET  /api/grocery/:source?url=&pages=&q=<keyword>
 */

const { Router } = require("express");
const {
  scrapeGrocerySource,
  scrapeAllGrocery,
  searchGrocerySource,
  searchAllGrocery,
  getMeenaCategories,
  SOURCES,
  SOURCE_DEFAULTS,
} = require("../scrapers/grocery/index");
const { asyncHandler }         = require("../middleware/errorHandler");
const { success, badRequest }  = require("../utils/response");
const { parsePages }           = require("../utils/validators");
const { cacheKey, getOrFetch } = require("../utils/cache");

const router = Router();

const ALLOWED_DOMAINS = {
  chaldal:      "chaldal.com",
  thebasketbd:  "thebasketbd.com",
  aamaderbazar: "aamaderbazar.com",
};

function isAllowedUrl(source, url) {
  try { return new URL(url).hostname.endsWith(ALLOWED_DOMAINS[source]); }
  catch { return false; }
}

// ─── GET /api/grocery/sources ─────────────────────────────────────────────────
router.get("/sources", (req, res) => {
  return success(res, {
    category: "Grocery",
    sources:  SOURCES.map((s) => ({
      source:     s,
      domain:     ALLOWED_DOMAINS[s],
      defaultUrl: SOURCE_DEFAULTS[s],
      searchable: true,
    })),
  });
});

// ─── GET /api/grocery/all?pages=&q= ──────────────────────────────────────────
router.get(
  "/all",
  asyncHandler(async (req, res) => {
    const pages   = parsePages(req.query.pages);
    const keyword = req.query.q?.trim() || "";

    if (keyword) {
      const key = cacheKey("grocery:search:all", { q: keyword, pages });
      let fromCache = true;
      const result  = await getOrFetch(key, () => {
        fromCache = false;
        return searchAllGrocery(keyword, pages);
      });
      return success(res, result.products, {
        category: "Grocery", sources: SOURCES,
        query: keyword, pages, count: result.products.length,
        errors: result.errors.length > 0 ? result.errors : undefined,
        cached: fromCache,
      });
    }

    const key = cacheKey("grocery:all", { pages });
    let fromCache = true;
    const result  = await getOrFetch(key, () => {
      fromCache = false;
      return scrapeAllGrocery(pages);
    });
    return success(res, result.products, {
      category: "Grocery", sources: SOURCES, pages,
      count: result.products.length,
      errors: result.errors.length > 0 ? result.errors : undefined,
      cached: fromCache,
    });
  })
);

// ─── GET /api/grocery/search?q=&source=&pages= ────────────────────────────────
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
    const key   = cacheKey("grocery:search", { q: keyword, source, pages });

    let fromCache = true;
    let result;

    if (source === "all") {
      result = await getOrFetch(key, () => {
        fromCache = false;
        return searchAllGrocery(keyword, pages);
      });
    } else {
      const products = await getOrFetch(key, () => {
        fromCache = false;
        return searchGrocerySource(keyword, source, pages);
      });
      result = { products, errors: [] };
    }

    return success(res, result.products, {
      category: "Grocery", query: keyword, source, pages,
      count: result.products.length,
      errors: result.errors?.length > 0 ? result.errors : undefined,
      cached: fromCache,
    });
  })
);

// ─── GET /api/grocery/aamaderbazar/categories ────────────────────────────────
router.get(
  "/aamaderbazar/categories",
  asyncHandler(async (req, res) => {
    const key = cacheKey("grocery:aamaderbazar:cats", {});
    let fromCache = true;
    const cats    = await getOrFetch(key, () => {
      fromCache = false;
      return getMeenaCategories(); // points to getAamaderBazarCategories internally
    });
    return success(res, cats, { source: "aamaderbazar", count: cats.length, cached: fromCache });
  })
);

// ─── backward compat: keep /meenabazaar/categories returning 404 ──────────────
router.get("/meenabazaar/categories", (req, res) => {
  res.status(410).json({ status: "error", message: "Meena Bazaar has been removed. Use /api/grocery/aamaderbazar/categories instead." });
});

// ─── GET /api/grocery/:source?url=&pages=&q= ─────────────────────────────────
router.get(
  "/:source",
  asyncHandler(async (req, res) => {
    const { source } = req.params;
    if (!SOURCES.includes(source))
      return badRequest(res, `Unknown source "${source}". Valid sources: ${SOURCES.join(", ")}`);

    const keyword = req.query.q?.trim() || "";
    const pages   = parsePages(req.query.pages);

    // If ?q= provided → search this source
    if (keyword) {
      const key = cacheKey(`grocery:search:${source}`, { q: keyword, pages });
      let fromCache = true;
      const products = await getOrFetch(key, () => {
        fromCache = false;
        return searchGrocerySource(keyword, source, pages);
      });
      return success(res, products, {
        source, category: "Grocery", query: keyword, pages,
        count: products.length, cached: fromCache,
      });
    }

    // browse
    const { url } = req.query;
    if (url && !isAllowedUrl(source, url))
      return badRequest(res, `URL must be on the ${ALLOWED_DOMAINS[source]} domain for source "${source}"`);

    const targetUrl = url || SOURCE_DEFAULTS[source];
    const key       = cacheKey(`grocery:${source}`, { url: targetUrl, pages });
    let fromCache   = true;
    const products  = await getOrFetch(key, () => {
      fromCache = false;
      return scrapeGrocerySource(source, targetUrl, pages);
    });
    return success(res, products, {
      source, category: "Grocery", url: targetUrl, pages,
      count: products.length, cached: fromCache,
    });
  })
);

module.exports = router;
