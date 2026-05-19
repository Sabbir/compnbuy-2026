/**
 * blucheezScraper.js
 * Scrapes product data from blucheez.fashion
 *
 * Platform: Shopify
 * Strategy: Shopify exposes a public, unauthenticated JSON API at
 *   /products.json?limit=250&page=N  (no key required)
 *   /collections/<handle>/products.json
 * This is much faster and more reliable than DOM scraping.
 * DOM fallback is used if the API is blocked.
 */

const { newPage } = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");

const BASE_URL    = "https://blucheez.fashion";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "blucheez";
const PER_PAGE    = 250; // Shopify max

// ─── Shopify JSON API ─────────────────────────────────────────────────────────

/**
 * Fetch Shopify products.json via in-browser fetch (bypasses CORS since
 * we're navigating the actual domain in Puppeteer).
 */
async function fetchShopifyPage(page, url) {
  return page.evaluate(async (apiUrl) => {
    try {
      const r = await fetch(apiUrl, { headers: { Accept: "application/json" } });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) return null;
      const text = await r.text();
      const first = text.trimStart()[0];
      if (first !== "{" && first !== "[") return null;
      try { return JSON.parse(text); } catch { return null; }
    } catch { return null; }
  }, url);
}

function normalizeShopifyProduct(p) {
  const variants = p.variants || [];

  // ── Price range handling ──────────────────────────────────────────────────
  // Shopify products.json: price fields are strings like "548.00" (already BDT).
  // Some endpoints send paisa (integer > 50000). We detect and convert.
  const parsePriceField = (val) => {
    if (val == null) return null;
    const n = parseFloat(val);
    if (isNaN(n)) return null;
    // Heuristic: if value is unreasonably large (>50000) it is in paisa
    return n > 50000 ? n / 100 : n;
  };

  // Min current price and max compare_at_price across all variants
  let minPrice = null, maxOrigPrice = null;
  variants.forEach((v) => {
    const vp = parsePriceField(v.price);
    const vo = parsePriceField(v.compare_at_price);
    if (vp != null && (minPrice === null || vp < minPrice)) minPrice = vp;
    if (vo != null && (maxOrigPrice === null || vo > maxOrigPrice)) maxOrigPrice = vo;
  });

  // Fallback to product-level price if no variants
  if (minPrice === null) minPrice = parsePriceField(p.price);

  const price     = minPrice;
  const origPrice = maxOrigPrice && maxOrigPrice > price ? maxOrigPrice : null;

  // Price range: e.g. Tk 548 – Tk 598
  const allPrices     = variants.map(v => parsePriceField(v.price)).filter(x => x != null);
  const maxPrice      = allPrices.length ? Math.max(...allPrices) : null;
  const hasPriceRange = maxPrice != null && maxPrice !== price;

  // Unique sizes
  const sizes = [...new Set(
    variants.map(v => v.option1 || v.title).filter(s => s && s !== "Default Title")
  )];

  // Unique colors
  const colors = [...new Set(variants.map(v => v.option2).filter(Boolean))];

  return {
    name:          p.title                    || "",
    price,
    maxPrice:      hasPriceRange ? maxPrice : null,
    originalPrice: origPrice,
    discount:      origPrice && price
      ? `-${Math.round((1 - price / origPrice) * 100)}%`
      : null,
    vendor:        p.vendor                   || null,
    productType:   p.product_type             || null,
    tags:          (p.tags || []).join(", ")  || null,
    sizes:         sizes.length ? sizes : null,
    colors:        colors.length ? colors : null,
    imageUrl:      p.images?.[0]?.src         || p.featured_image || "",
    productUrl:    `${BASE_URL}/products/${p.handle}`,
    inStock:       p.available                ?? true,
    variantCount:  variants.length            || 1,
  };
}

// ─── DOM Fallback ─────────────────────────────────────────────────────────────

function extractFromDom() {
  // Parse the FIRST numeric value from a raw price string.
  // Handles: "Tk 548", "Tk 548 – Tk 598", "548.00"
  const cleanPrice = (raw) => {
    if (!raw) return null;
    const m = raw.replace(/[^\d.\s–-]/g, "").match(/[\d.]+/);
    const n = m ? parseFloat(m[0]) : NaN;
    return isNaN(n) ? null : n;
  };

  // Parse the LAST numeric value — used for the upper end of a price range.
  const cleanPriceMax = (raw) => {
    if (!raw) return null;
    const matches = [...(raw.replace(/[^\d.\s–-]/g, "").matchAll(/[\d.]+/g))];
    if (!matches.length) return null;
    const n = parseFloat(matches[matches.length - 1][0]);
    return isNaN(n) ? null : n;
  };

  // Shopify themes use .product-item, .grid__item, or [class*="product-card"]
  const selectors = [
    ".product-item",
    ".grid__item",
    "[class*='product-card']",
    "[class*='ProductCard']",
    "[class*='product-grid'] li",
    ".collection-grid__item",
    "li[class*='item']",
  ];

  let cards = [];
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 2) { cards = found; break; }
  }

  return Array.from(cards).map((card) => {
    const nameEl   = card.querySelector("[class*='title'], [class*='name'], h2, h3");
    const imgEl    = card.querySelector("img");
    const linkEl   = card.querySelector("a");

    const name = nameEl?.textContent?.trim() || "";
    if (!name) return null;

    // ── Price extraction ──────────────────────────────────────────────────
    // Case 1: price range  → .t4s-price__sale (e.g. "Tk 548 – Tk 598")
    // Case 2: sale price   → ins .money  (current)  + del .money (original)
    // Case 3: single price → [class*='price'] first .money span

    let price = null, maxPrice = null, origPrice = null;

    const rangeEl = card.querySelector(".t4s-price__sale");
    const insEl   = card.querySelector("ins");
    const delEl   = card.querySelector("del");
    const priceEl = card.querySelector("[data-pr-price], [class*='product-price']");

    if (rangeEl) {
      // "Tk 548 – Tk 598" — extract both ends
      const rangeText = rangeEl.textContent || "";
      price    = cleanPrice(rangeText);
      maxPrice = cleanPriceMax(rangeText);
      if (maxPrice === price) maxPrice = null;  // same value, not really a range
    } else if (insEl) {
      price     = cleanPrice(insEl.textContent);
      origPrice = delEl ? cleanPrice(delEl.textContent) : null;
    } else if (priceEl) {
      price = cleanPrice(priceEl.textContent);
    }

    return {
      name,
      price,
      maxPrice:      maxPrice,
      originalPrice: origPrice && origPrice > price ? origPrice : null,
      discount:      null,
      imageUrl:      imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazySrc || "",
      productUrl:    linkEl?.href || "",
    };
  }).filter(Boolean);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape Blucheez products.
 * @param {string} collectionUrl  e.g. "https://blucheez.fashion/collections/all"
 *                                or any Shopify collection URL
 * @param {number} pages
 */
async function scrapeBlucheez(collectionUrl = `${BASE_URL}/collections/all`, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    // Navigate to the collection page first to set cookies/session
    await navigateTo(page, collectionUrl);

    // Derive API URL from collection URL
    // e.g. /collections/all -> /collections/all/products.json
    //      /collections/men -> /collections/men/products.json
    const apiBase = collectionUrl.includes("/collections/")
      ? collectionUrl.replace(/\/$/, "") + "/products.json"
      : `${BASE_URL}/products.json`;

    let apiWorked = false;

    for (let p = 1; p <= pages; p++) {
      const apiUrl = `${apiBase}?limit=${PER_PAGE}&page=${p}`;
      const data   = await fetchShopifyPage(page, apiUrl);

      if (data?.products && data.products.length > 0) {
        results.push(...data.products.map(normalizeShopifyProduct));
        apiWorked = true;
        if (data.products.length < PER_PAGE) break; // last page
      } else {
        break;
      }

      if (p < pages) await sleep(DELAY);
    }

    // DOM fallback if API returned nothing
    if (!apiWorked) {
      for (let p = 1; p <= pages; p++) {
        const url = p === 1 ? collectionUrl : `${collectionUrl}?page=${p}`;
        if (p > 1) await navigateTo(page, url);
        await autoScroll(page);
        const products = await page.evaluate(extractFromDom);
        if (products.length === 0) break;
        results.push(...products);
        if (p < pages) await sleep(DELAY);
      }
    }
  } finally {
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Clothing" }));
}

/**
 * Get all Shopify collections for Blucheez.
 */
async function getBlucheezCollections() {
  const page = await newPage();
  try {
    await navigateTo(page, BASE_URL);
    const data = await fetchShopifyPage(page, `${BASE_URL}/collections.json?limit=50`);
    return (data?.custom_collections || []).map((c) => ({
      name:   c.title,
      handle: c.handle,
      url:    `${BASE_URL}/collections/${c.handle}`,
    }));
  } finally {
    await page.close();
  }
}


/**
 * Search Blucheez products by keyword.
 * Shopify exposes /search/suggest.json and /search?q=<keyword>&type=product
 * We use the Shopify storefront search JSON endpoint first, then DOM fallback.
 * @param {string} keyword
 * @param {number} pages
 */
async function searchBlucheez(keyword, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    // Navigate to search page so session/cookies are set
    const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(keyword)}&type=product`;
    await navigateTo(page, searchUrl);

    // Try Shopify products.json filtered by search (no native filter, use suggest API)
    const suggestUrl = `${BASE_URL}/search/suggest.json?q=${encodeURIComponent(keyword)}&resources[type]=product&resources[limit]=20`;
    const suggest    = await fetchShopifyPage(page, suggestUrl);
    const hits       = suggest?.resources?.results?.products || [];

    if (hits.length > 0) {
      results.push(...hits.map((p) => ({
        name:          p.title || "",
        price:         parseFloat(p.price)          || null,
        originalPrice: parseFloat(p.compare_at_price) || null,
        discount:      null,
        imageUrl:      p.image?.url                 || p.featured_image || "",
        productUrl:    p.url?.startsWith("http")
          ? p.url
          : `${BASE_URL}${p.url}`,
        vendor:        p.vendor                     || null,
        productType:   p.product_type               || null,
      })));
    } else {
      // DOM fallback — search results rendered in same product grid
      for (let p = 1; p <= pages; p++) {
        const url = p === 1 ? searchUrl : `${searchUrl}&page=${p}`;
        if (p > 1) await navigateTo(page, url);
        await autoScroll(page);
        const dom = await page.evaluate(extractFromDom);
        if (dom.length === 0) break;
        results.push(...dom);
        if (p < pages) await sleep(DELAY);
      }
    }
  } finally {
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Clothing" }));
}

module.exports = { scrapeBlucheez, getBlucheezCollections, searchBlucheez };
