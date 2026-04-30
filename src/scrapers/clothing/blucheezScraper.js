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
  const variant  = p.variants?.[0] || {};
  const price    = parseFloat(variant.price)         || parseFloat(p.price) || null;
  const origPrice = parseFloat(variant.compare_at_price) || null;

  // Collect all unique sizes from variants
  const sizes = [...new Set(
    (p.variants || [])
      .map(v => v.option1 || v.title)
      .filter(s => s && s !== "Default Title")
  )];

  // Collect all unique colors
  const colors = [...new Set(
    (p.variants || [])
      .map(v => v.option2)
      .filter(Boolean)
  )];

  return {
    name:          p.title                    || "",
    price,
    originalPrice: origPrice > price ? origPrice : null,
    discount:      origPrice > price
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
    variantCount:  (p.variants || []).length  || 1,
  };
}

// ─── DOM Fallback ─────────────────────────────────────────────────────────────

function extractFromDom() {
  const cleanPrice = (raw) => {
    const n = parseFloat((raw || "").replace(/[^\d.]/g, ""));
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
    console.log(found)
    if (found.length > 2) { cards = found; break; }
  }

  return Array.from(cards).map((card) => {
    const nameEl   = card.querySelector("[class*='title'], [class*='name'], h2, h3");
    const priceEl  = card.querySelector("[class*='price']:not([class*='compare']):not([class*='was'])");
    const origEl   = card.querySelector("[class*='compare'], [class*='was'], s, del");
    const imgEl    = card.querySelector("img");
    const linkEl   = card.querySelector("a");

    const name = nameEl?.textContent?.trim() || "";
    if (!name) return null;

    return {
      name,
      price:         cleanPrice(priceEl?.textContent),
      originalPrice: cleanPrice(origEl?.textContent),
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
        console.log(products)
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
    const suggestUrl = `${BASE_URL}/search?q=${encodeURIComponent(keyword)}`;
    const suggest    = await fetchShopifyPage(page, suggestUrl);
    const hits       = suggest?.resources?.results?.products || [];

    if (hits.length > 0) {
      console.log(hits.length)
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
        console.log(searchUrl)
        if (p > 1) await navigateTo(page, url);
        await autoScroll(page);
        const dom = await page.evaluate(extractFromDom);
        if (dom.length === 0) break;
        results.push(...dom);
        if (p < pages) await sleep(DELAY);
      }
    }
  } catch(error){
    console.log(error.message)
  }
   finally {
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Clothing" }));
}

module.exports = { scrapeBlucheez, getBlucheezCollections, searchBlucheez };
