/**
 * startechScraper.js
 * Scrapes product data from startech.com.bd
 *
 * Platform: Custom PHP e-commerce (OpenCart-like custom system)
 * Strategy:
 *  1. Try /index.php?route=product/search&search=<q>&limit=96 JSON API
 *  2. Intercept XHR/Fetch calls that return product JSON
 *  3. DOM: standard StarTech grid (.p-item / .p-name / .p-price selectors)
 *
 * Pagination: ?page=N  (URL param)
 * Category URLs: /laptop-notebook, /desktop/desktop-pc, /monitor, etc.
 */

const { newPage }                      = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");

const BASE_URL    = "https://www.startech.com.bd";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "startech";

// ─── DOM Extractor ─────────────────────────────────────────────────────────────

function extractProducts() {
  const cleanPrice = (raw) => {
    if (!raw) return null;
    // StarTech uses Bengali Taka sign ৳ and commas
    const n = parseFloat(raw.replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  // StarTech uses .p-item cards inside .p-grid
  const selectors = [
    ".p-item",
    ".product-layout",
    "[class*='product-layout']",
    ".product-grid .product-item",
    "[class*='p-item']",
  ];

  let cards = [];
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 1) { cards = found; break; }
  }

  return Array.from(cards).map((card) => {
    // Name: .p-item-name or h4.name or similar
    const nameEl = card.querySelector(
      ".p-item-name, .p-item-title, h4.name, .name a, [class*='product-name'], h4, h3, h2"
    );
    const name = nameEl?.getAttribute("title") || nameEl?.textContent?.trim() || "";
    if (!name) return null;

    // Price: .p-item-price, .price (exclude old/special)
    const priceEl  = card.querySelector(
      ".p-item-price, .price:not(.old-price):not(.special-price) span, [class*='price'] span"
    );
    const origEl   = card.querySelector(".old-price, .regular-price, del, s");
    const badgeEl  = card.querySelector(".sticker, .badge, [class*='discount'], [class*='onsale'], .offer");
    const imgEl    = card.querySelector("img");
    const linkEl   = card.querySelector("a");
    const ratingEl = card.querySelector(".rating, [class*='star'], .stars");
    const brandEl  = card.querySelector("[class*='brand'], .manufacturer, [class*='vendor']");

    const price     = cleanPrice(priceEl?.textContent);
    const origPrice = cleanPrice(origEl?.textContent);

    return {
      name,
      price,
      originalPrice: origPrice && origPrice > price ? origPrice : null,
      discount:
        badgeEl?.textContent?.trim() ||
        (origPrice && price && origPrice > price
          ? `-${Math.round((1 - price / origPrice) * 100)}%`
          : null),
      brand:      brandEl?.textContent?.trim() || null,
      rating:     ratingEl?.textContent?.trim() || null,
      imageUrl:   imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazySrc || "",
      productUrl: linkEl?.href
        ? linkEl.href.startsWith("http") ? linkEl.href : "https://www.startech.com.bd" + linkEl.href
        : "",
    };
  }).filter(Boolean);
}

// ─── JSON API probe (StarTech search endpoint) ────────────────────────────────

async function trySearchApi(page, query, pageNum = 1) {
  const url = `${BASE_URL}/index.php?route=product/search&search=${encodeURIComponent(query)}&limit=96&page=${pageNum}`;
  // Also try JSON variant
  const jsonUrl = `${BASE_URL}/product/search?q=${encodeURIComponent(query)}&page=${pageNum}&format=json`;

  for (const endpoint of [jsonUrl]) {
    try {
      const data = await page.evaluate(async (u) => {
        const r = await fetch(u, { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "true" } });
        if (!r.ok) return null;
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("json")) return null;
        return r.json();
      }, endpoint);

      if (data) {
        const items = data.products || data.data || data.items || (Array.isArray(data) ? data : null);
        if (Array.isArray(items) && items.length > 0) return items.map(normalizeApiProduct);
      }
    } catch { /* skip */ }
  }
  return null;
}

function normalizeApiProduct(p) {
  const cleanP = (v) => { const n = parseFloat(String(v || "").replace(/[^\d.]/g, "")); return isNaN(n) ? null : n; };
  return {
    name:          p.name || p.title || "",
    price:         cleanP(p.price || p.special || p.sale_price),
    originalPrice: cleanP(p.price_old || p.regular_price || p.original),
    discount:      p.discount || null,
    brand:         p.manufacturer || p.brand || null,
    rating:        p.rating || null,
    imageUrl:      p.thumb || p.image || p.image_url || "",
    productUrl:    p.href || (p.id ? `${BASE_URL}/product/${p.id}` : ""),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape StarTech product listings.
 * @param {string} listingUrl   e.g. "https://www.startech.com.bd/laptop-notebook"
 * @param {number} pages
 */
async function scrapeStarTech(listingUrl = `${BASE_URL}/laptop-notebook`, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    for (let p = 1; p <= pages; p++) {
      const url = p === 1 ? listingUrl : `${listingUrl}?page=${p}`;
      await navigateTo(page, url);
      await autoScroll(page);

      const products = await page.evaluate(extractProducts);
      if (products.length === 0) break;
      results.push(...products);

      if (p < pages) await sleep(DELAY);
    }
  } finally {
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Electronics" }));
}

/**
 * Scrape StarTech by search keyword.
 * @param {string} keyword
 * @param {number} pages
 */
async function searchStarTech(keyword, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    const searchUrl = `${BASE_URL}/index.php?route=product/search&search=${encodeURIComponent(keyword)}`;
    await navigateTo(page, searchUrl);

    // Try API first
    const apiData = await trySearchApi(page, keyword);
    if (apiData && apiData.length > 0) {
      results.push(...apiData);
    } else {
      for (let p = 1; p <= pages; p++) {
        if (p > 1) await navigateTo(page, `${searchUrl}&page=${p}`);
        await autoScroll(page);
        const products = await page.evaluate(extractProducts);
        if (products.length === 0) break;
        results.push(...products);
        if (p < pages) await sleep(DELAY);
      }
    }
  } finally {
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Electronics" }));
}

/**
 * Get StarTech top-level categories.
 */
async function getStarTechCategories() {
  const page = await newPage();
  try {
    await navigateTo(page, BASE_URL);
    return page.evaluate(() => {
      const links = document.querySelectorAll(
        "#main-menu a, .navbar a, nav.main-nav a, .nav-menu a, .main-navigation a"
      );
      return Array.from(links)
        .map((a) => ({ name: a.textContent.trim(), url: a.href }))
        .filter((c) => c.name.length > 1 && c.url.includes("startech.com.bd") && !c.url.includes("#"));
    });
  } finally {
    await page.close();
  }
}

module.exports = { scrapeStarTech, searchStarTech, getStarTechCategories };
