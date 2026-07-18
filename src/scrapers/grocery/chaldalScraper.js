/**
 * chaldalScraper.js
 *
 * CONFIRMED API (from live response, July 2026):
 *   GET https://eggyolk.chaldal.com/api/Product/Search?query=rice&warehouseId=1
 *
 * RESPONSE SHAPE:
 *   {
 *     "Products":  [...],   ← array of products
 *     "PageIndex": 0,
 *     "PageSize":  50,
 *     "NumMatches": 52,
 *     "Dynamics":  null
 *   }
 *
 * PRODUCT FIELDS (all confirmed from real data):
 *   ProductVariantId  ← numeric ID
 *   Name              ← full name e.g. "Paijam Rice (Boiled) 1 kg"
 *   SubText           ← unit/weight e.g. "1 kg"
 *   Price             ← MRP / original price  { Lo, Mid, Hi, SignScale }
 *   DiscountedPrice   ← actual selling price  { Lo, Mid, Hi, SignScale }
 *                        Price > DiscountedPrice → item is on sale
 *                        Price = DiscountedPrice → no discount
 *   Slug              ← URL slug e.g. "paijam-rice-boiled-1-kg"
 *   PictureUrls       ← string[] — use index [0]
 *   ProductAvailabilityForSelectedWarehouse
 *                     ← array; EMPTY = out of stock,
 *                        any entry with Quantity > 0 = in stock
 *
 * FALLBACK:
 *   If the GET API is unreachable, falls back to Puppeteer + location
 *   cookie injection to bypass the city-picker gate, then intercepts XHR.
 */

const { newPage }           = require("../../browser/browserManager");
const { navigateTo, sleep } = require("../../browser/pageHelpers");

const BASE_URL     = "https://chaldal.com";
const API_URL      = "https://eggyolk.chaldal.com/api/Product/Search";
const SOURCE_NAME  = "chaldal";
const WAREHOUSE_ID = parseInt(process.env.CHALDAL_WAREHOUSE_ID) || 1;
const PAGE_SIZE    = 50;
const API_TIMEOUT  = 15000;

// ─── DecimalDTO → number ──────────────────────────────────────────────────────
// Chaldal encodes BDT prices as { Lo, Mid, Hi, SignScale }.
// For all observed BDT prices: Mid=0, Hi=0, SignScale=0 → value = Lo.
function dtoToNumber(dto) {
  if (dto == null) return null;
  if (typeof dto === "number") return dto;
  if (typeof dto !== "object") return parseFloat(String(dto)) || null;

  const { Lo = 0, Mid = 0, Hi = 0, SignScale = 0 } = dto;

  // Fast path — covers 100% of BDT prices seen in real data
  if (SignScale === 0 && Mid === 0 && Hi === 0) return Lo;

  // Full decode for fractional/large values
  try {
    const isNeg = (SignScale & 0x80000000) !== 0;
    const scale = (SignScale >>> 16) & 0xff;
    const raw   = (BigInt(Hi >>> 0) << 64n)
                | (BigInt(Mid >>> 0) << 32n)
                |  BigInt(Lo >>> 0);
    const value = Number(raw) / Math.pow(10, scale);
    return isNeg ? -value : value;
  } catch {
    return Lo || null;
  }
}

// ─── Normalizer ───────────────────────────────────────────────────────────────
function normalizeProduct(p, query) {
  const mrp      = dtoToNumber(p.Price);           // original / MRP
  const selling  = dtoToNumber(p.DiscountedPrice); // what customer pays

  // currentPrice  = selling price (DiscountedPrice)
  // originalPrice = only set when there's an actual discount
  const currentPrice  = selling ?? mrp;
  const originalPrice = (mrp && selling && mrp > selling) ? mrp : null;

  let discount = null;
  if (originalPrice && currentPrice) {
    const pct = Math.round((1 - currentPrice / originalPrice) * 100);
    if (pct > 0) discount = `-${pct}%`;
  }

  // Stock: empty array = out of stock; any entry with Quantity > 0 = in stock
  const avail   = p.ProductAvailabilityForSelectedWarehouse;
  const inStock = Array.isArray(avail) && avail.length > 0
    ? avail.some((a) => (a.Quantity ?? 0) > 0)
    : false;

  // Image: PictureUrls[0]
  const pics     = Array.isArray(p.PictureUrls) ? p.PictureUrls : [];
  const imageUrl = pics[0]
    ? (pics[0].startsWith("//") ? "https:" + pics[0] : pics[0])
    : "";

  const slug       = p.Slug || "";
  const productUrl = slug
    ? `${BASE_URL}/${slug}`
    : p.ProductVariantId
      ? `${BASE_URL}/product/${p.ProductVariantId}`
      : "";

  return {
    name:          p.Name   || "",
    price:         currentPrice,
    originalPrice,
    discount,
    unit:          p.SubText || null,
    imageUrl,
    productUrl,
    inStock,
    source:        SOURCE_NAME,
    category:      "Grocery",
    query:         query || "",
  };
}

// ─── Strategy 1: Direct GET API ───────────────────────────────────────────────
async function fetchViaApi(keyword) {
  const { default: fetch } = await import("node-fetch");

  const url = `${API_URL}?query=${encodeURIComponent(keyword)}&warehouseId=${WAREHOUSE_ID}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: {
        "Accept":          "application/json",
        "Origin":          "https://chaldal.com",
        "Referer":         "https://chaldal.com/",
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      },
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[chaldal] API ${res.status} for "${keyword}"`);
      return null;
    }

    const json = await res.json().catch(() => null);
    if (!json) return null;

    // Confirmed shape: { Products: [...], PageIndex, PageSize, NumMatches, Dynamics }
    const items = json.Products || json.products || (Array.isArray(json) ? json : null);

    if (!items) {
      console.warn(`[chaldal] Unexpected response. Keys: ${Object.keys(json).join(", ")}`);
      return null;
    }

    return items;
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[chaldal] API error for "${keyword}":`,
      err.name === "AbortError" ? "timeout" : err.message);
    return null;
  }
}

// ─── Strategy 2: Browser + cookie injection (fallback) ───────────────────────
async function fetchViaBrowser(keyword) {
  const page = await newPage();
  try {
    // Inject location cookies before navigation to bypass city-picker gate
    await page.setCookie(
      { name: "warehouseId",     value: String(WAREHOUSE_ID), domain: ".chaldal.com", path: "/" },
      { name: "deliveryAreaId",  value: "1",                  domain: ".chaldal.com", path: "/" },
      { name: "hasSelectedCity", value: "true",               domain: ".chaldal.com", path: "/" }
    );

    const captured = [];

    const handler = async (response) => {
      try {
        const url    = response.url();
        const status = response.status();
        if (status < 200 || status >= 300) return;
        if (!url.includes("eggyolk.chaldal.com/api/Product/Search")) return;

        const text = await response.text().catch(() => "");
        if (!text || text[0] === "<") return;

        const json  = JSON.parse(text);
        const items = json.Products || json.products || (Array.isArray(json) ? json : null);
        if (Array.isArray(items) && items.length > 0) captured.push(...items);
      } catch { /* skip */ }
    };

    page.on("response", handler);

    const slug = keyword.trim().toLowerCase().replace(/\s+/g, "-");
    await navigateTo(page, `${BASE_URL}/search/${encodeURIComponent(slug)}`);
    await sleep(4000);

    page.off("response", handler);
    return captured.length > 0 ? captured : null;
  } finally {
    await page.close();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
async function searchChaldal(keyword, _pages = 1) {
  if (!keyword?.trim()) throw new Error("keyword is required");

  const q = keyword.trim();
  console.log(`[chaldal] Searching: "${q}" (warehouseId=${WAREHOUSE_ID})`);

  let raw = await fetchViaApi(q);

  if (!raw) {
    console.log(`[chaldal] Falling back to browser for "${q}"`);
    try { raw = await fetchViaBrowser(q); }
    catch (err) { console.error(`[chaldal] Browser fallback failed:`, err.message); }
  }

  if (!raw?.length) {
    console.warn(`[chaldal] No products found for "${q}"`);
    return [];
  }

  console.log(`[chaldal] ${raw.length} raw products for "${q}"`);

  return raw
    .map((p) => normalizeProduct(p, q))
    .filter((p) => p.name && p.price !== null);
}

async function scrapeChaldal(categoryUrl = BASE_URL) {
  const segment = (categoryUrl.split("/").pop() || "grocery").replace(/-/g, " ");
  return searchChaldal(segment);
}

module.exports = { scrapeChaldal, searchChaldal };
