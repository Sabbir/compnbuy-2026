/**
 * searchRoutes.js
 * GET /api/search?q=keyword&pages=2
 */

const { Router } = require("express");
const { scrapeSearch } = require("../scrapers/listingScraper");
const { asyncHandler } = require("../middleware/errorHandler");
const { success, badRequest } = require("../utils/response");
const { parsePages } = require("../utils/validators");
const { cacheKey, getOrFetch } = require("../utils/cache");

const router = Router();

/**
 * @route   GET /api/search
 * @query   q       {string}  required — search keyword
 * @query   pages   {number}  optional — pages to scrape (default 1, max 10)
 * @returns { status, query, pages, count, cached, data[] }
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    console.log(q)

    if (!q || !q.trim()) {
      return badRequest(res, 'Query parameter "q" is required');
    }

    const keyword = q.trim();
    const pages   = parsePages(req.query.pages);
    const key     = cacheKey("search", { q: keyword, pages });

    let fromCache = true;
    const products = await getOrFetch(key, () => {
      fromCache = false;
      return scrapeSearch(keyword, pages);
    });

    return success(res, products, {
      query:  keyword,
      pages,
      count:  products.length,
      cached: fromCache,
    });
  })
);

module.exports = router;
