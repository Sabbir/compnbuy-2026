/**
 * categoryRoutes.js
 * GET /api/category?url=<daraz-category-url>&pages=2
 */

const { Router } = require("express");
const { scrapeCategory } = require("../scrapers/listingScraper");
const { asyncHandler } = require("../middleware/errorHandler");
const { success, badRequest } = require("../utils/response");
const { isValidDarazUrl, parsePages } = require("../utils/validators");
const { cacheKey, getOrFetch } = require("../utils/cache");

const router = Router();

/**
 * @route   GET /api/category
 * @query   url     {string}  required — full Daraz category URL
 * @query   pages   {number}  optional — pages to scrape (default 1, max 10)
 * @returns { status, url, pages, count, cached, data[] }
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { url } = req.query;

    if (!url)                  return badRequest(res, 'Query parameter "url" is required');
    if (!isValidDarazUrl(url)) return badRequest(res, '"url" must be a valid daraz.com.bd URL');

    const pages = parsePages(req.query.pages);
    const key   = cacheKey("category", { url, pages });

    let fromCache = true;
    const products = await getOrFetch(key, () => {
      fromCache = false;
      return scrapeCategory(url, pages);
    });

    return success(res, products, {
      url,
      pages,
      count:  products.length,
      cached: fromCache,
    });
  })
);

module.exports = router;
