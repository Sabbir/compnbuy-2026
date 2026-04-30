/**
 * electronicsRoutes.js
 * REST endpoints for the Electronics category.
 *
 * GET  /api/electronics/sources                    → list sources + default URLs
 * GET  /api/electronics/all?pages=<n>              → all 3 sources in parallel
 * GET  /api/electronics/search?q=<kw>&source=<s>  → keyword search (startech, ryans, or all)
 * GET  /api/electronics/:source?url=&pages=        → single source
 * GET  /api/electronics/:source/categories         → categories for a source
 */

const { Router } = require("express");
const {
  scrapeElectronicsSource,
  scrapeAllElectronics,
  searchElectronics,
  getElectronicsCategories,
  SOURCES,
  SOURCE_DEFAULTS,
} = require("../scrapers/electronics/index");
const { asyncHandler }         = require("../middleware/errorHandler");
const { success, badRequest }  = require("../utils/response");
const { parsePages }           = require("../utils/validators");
const { cacheKey, getOrFetch } = require("../utils/cache");

const router = Router();

const ALLOWED_DOMAINS = {
  startech: "startech.com.bd",
  ryans:    "ryans.com",
  vertech:  "vertech.com.bd",
};

function isAllowedUrl(source, url) {
  try {
    return new URL(url).hostname.endsWith(ALLOWED_DOMAINS[source]);
  } catch { return false; }
}

// ─── GET /api/electronics/sources ────────────────────────────────────────────
router.get("/sources", (req, res) => {
  return success(res, {
    category: "Electronics",
    sources:  SOURCES.map((s) => ({
      source:      s,
      domain:      ALLOWED_DOMAINS[s],
      defaultUrl:  SOURCE_DEFAULTS[s],
      searchable:  ["startech", "ryans"].includes(s),
    })),
  });
});

// ─── GET /api/electronics/all ─────────────────────────────────────────────────
router.get(
  "/all",
  asyncHandler(async (req, res) => {
    const pages = parsePages(req.query.pages);
    const key   = cacheKey("electronics:all", { pages });

    let fromCache = true;
    const result  = await getOrFetch(key, () => {
      fromCache = false;
      return scrapeAllElectronics(pages);
    });

    return success(res, result.products, {
      category: "Electronics",
      sources:  SOURCES,
      pages,
      count:    result.products.length,
      errors:   result.errors.length > 0 ? result.errors : undefined,
      cached:   fromCache,
    });
  })
);

// ─── GET /api/electronics/search ─────────────────────────────────────────────
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const { q, source = "all" } = req.query;

    if (!q || !q.trim()) return badRequest(res, 'Query parameter "q" is required');

    const validSources = ["all", "startech", "ryans"];
    if (!validSources.includes(source)) {
      return badRequest(res, `"source" must be one of: ${validSources.join(", ")}`);
    }

    const pages   = parsePages(req.query.pages);
    const keyword = q.trim();
    const key     = cacheKey("electronics:search", { q: keyword, source, pages });

    let fromCache = true;
    const result  = await getOrFetch(key, () => {
      fromCache = false;
      return searchElectronics(keyword, source, pages);
    });

    return success(res, result.products, {
      category: "Electronics",
      query:    keyword,
      source,
      pages,
      count:    result.products.length,
      errors:   result.errors?.length > 0 ? result.errors : undefined,
      cached:   fromCache,
    });
  })
);

// ─── GET /api/electronics/:source/categories ─────────────────────────────────
router.get(
  "/:source/categories",
  asyncHandler(async (req, res) => {
    const { source } = req.params;
    if (!SOURCES.includes(source)) {
      return badRequest(res, `Unknown source "${source}". Valid: ${SOURCES.join(", ")}`);
    }

    const key = cacheKey(`electronics:${source}:cats`, {});
    let fromCache = true;
    const cats    = await getOrFetch(key, () => {
      fromCache = false;
      return getElectronicsCategories(source);
    });

    return success(res, cats, { source, count: cats.length, cached: fromCache });
  })
);

// ─── GET /api/electronics/:source ────────────────────────────────────────────
router.get(
  "/:source",
  asyncHandler(async (req, res) => {
    const { source } = req.params;
    if (!SOURCES.includes(source)) {
      return badRequest(res, `Unknown source "${source}". Valid: ${SOURCES.join(", ")}`);
    }

    const { url } = req.query;
    if (url && !isAllowedUrl(source, url)) {
      return badRequest(
        res,
        `URL must be on the ${ALLOWED_DOMAINS[source]} domain for source "${source}"`
      );
    }

    const pages     = parsePages(req.query.pages);
    const targetUrl = url || SOURCE_DEFAULTS[source];
    const key       = cacheKey(`electronics:${source}`, { url: targetUrl, pages });

    let fromCache = true;
    const products  = await getOrFetch(key, () => {
      fromCache = false;
      return scrapeElectronicsSource(source, targetUrl, pages);
    });

    return success(res, products, {
      source,
      category: "Electronics",
      url:      targetUrl,
      pages,
      count:    products.length,
      cached:   fromCache,
    });
  })
);

module.exports = router;
