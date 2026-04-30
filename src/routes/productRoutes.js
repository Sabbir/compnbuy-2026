/**
 * productRoutes.js
 * GET  /api/product?url=<product-url>
 * POST /api/product/bulk  { "urls": ["url1", "url2"] }
 */

const { Router } = require("express");
const { scrapeDetails } = require("../scrapers/detailScraper");
const { asyncHandler } = require("../middleware/errorHandler");
const { success, badRequest } = require("../utils/response");
const { isValidDarazUrl } = require("../utils/validators");
const { cacheKey, getOrFetch } = require("../utils/cache");

const router = Router();

/**
 * @route   GET /api/product
 * @query   url {string} required — full Daraz product URL
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { url } = req.query;
    console.log(url)

    if (!url)                  return badRequest(res, 'Query parameter "url" is required');
    if (!isValidDarazUrl(url)) return badRequest(res, '"url" must be a valid daraz.com.bd URL');

    const key = cacheKey("product", { url });

    let fromCache = true;
    const product = await getOrFetch(key, async () => {
      fromCache = false;
      const [p] = await scrapeDetails([url]);
      return p;
    });

    return success(res, product, { cached: fromCache });
  })
);

/**
 * @route   POST /api/product/bulk
 * @body    { urls: string[] }  — up to 20 product URLs
 */
router.post(
  "/bulk",
  asyncHandler(async (req, res) => {
    const { urls } = req.body || {};

    if (!Array.isArray(urls) || urls.length === 0)
      return badRequest(res, 'Body must contain a non-empty "urls" array');
    if (urls.length > 20)
      return badRequest(res, "Maximum 20 URLs per bulk request");

    const invalid = urls.filter((u) => !isValidDarazUrl(u));
    if (invalid.length > 0)
      return badRequest(res, `Invalid daraz.com.bd URLs: ${invalid.join(", ")}`);

    const key = cacheKey("bulk", { urls: [...urls].sort().join(",") });

    let fromCache = true;
    const products = await getOrFetch(key, () => {
      fromCache = false;
      return scrapeDetails(urls);
    });

    return success(res, products, { count: products.length, cached: fromCache });
  })
);

module.exports = router;
