/**
 * fabrilifeScraper.js
 *
 * Platform: Fabrilife.com — custom Laravel/PHP e-commerce (BD fashion brand)
 *
 * STRATEGY:
 *   Fabrilife blocks plain HTTP requests (403) and renders products via JS
 *   after page load. We use Puppeteer with XHR interception:
 *
 *   1. Set up response listener BEFORE navigating (so we catch the XHR that
 *      fires during page load — the old scraper missed this by listening after)
 *   2. Navigate and wait longer (2s) for JS to finish rendering
 *   3. If XHR captured JSON products → normalise and return
 *   4. Fallback: evaluate DOM with Fabrilife-specific selectors
 *
 * SEARCH URL:  https://fabrilife.com/products?search=<keyword>
 *              (not /search?q= — that 404s on Fabrilife)
 * LISTING URL: https://fabrilife.com/products?page=N
 */

const { newPage }           = require("../../browser/browserManager");
const { navigateTo, sleep } = require("../../browser/pageHelpers");

const BASE_URL    = "https://fabrilife.com";
const SOURCE_NAME = "fabrilife";
const JS_WAIT     = 2000; // ms extra wait for Fabrilife's JS to render cards

// ─── Normalizer ───────────────────────────────────────────────────────────────
function normalizeProduct(p) {
  const clean = (v) => {
    const n = parseFloat(String(v || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  const slug = p.slug || p.handle || p.code || "";
  const url  = p.url  || p.link   || p.product_url ||
               (slug ? `${BASE_URL}/products/${slug}` : "");

  // Image: try several field names
  const img = p.image || p.thumbnail || p.photo ||
              p.image_url || p.featured_image ||
              p.images?.[0]?.src || p.images?.[0] || "";

  return {
    name:          p.name          || p.title        || p.product_name || "",
    price:         clean(p.price   || p.sale_price   || p.current_price),
    originalPrice: clean(p.regular_price || p.mrp    || p.original_price),
    discount:      p.discount      || p.discount_text || null,
    unit:          p.unit          || null,
    imageUrl:      typeof img === "string" ? img : "",
    productUrl:    url,
    inStock:       p.in_stock      ?? p.available    ?? p.stock_status !== "outofstock" ?? true,
    source:        SOURCE_NAME,
    category:      "Clothing",
  };
}

// ─── XHR capture helper ───────────────────────────────────────────────────────
// Attaches BEFORE navigation so no XHR is missed.
function attachXhrCapture(page) {
  const captured = [];

  const handler = async (res) => {
    try {
      const url = res.url();
      const ct  = res.headers()["content-type"] || "";
      const status = res.status();
      if (status < 200 || status >= 300) return;
      if (!ct.includes("json")) return;
      // Only intercept Fabrilife's own domain
      if (!url.includes("fabrilife.com")) return;

      const text = await res.text().catch(() => "");
      if (!text) return;
      const t = text.trimStart();
      if (t[0] !== "{" && t[0] !== "[") return;

      const json  = JSON.parse(t);
      const items =
        json.data?.data || json.data?.products ||
        json.data        || json.products      ||
        json.items       || json.results       ||
        (Array.isArray(json) ? json : null);

      if (Array.isArray(items) && items.length > 0) {
        captured.push(...items);
      }
    } catch { /* skip */ }
  };

  page.on("response", handler);
  return { captured, handler };
}

// ─── DOM extractor (runs inside Chromium) ─────────────────────────────────────
function extractFromDom() {
  const clean = (raw) => {
    const n = parseFloat((raw || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  // Fabrilife-specific selectors (observed from their site structure)
  const selectors = [
    ".product-card",
    ".single-product",
    ".product-item",
    "[class*='product-card']",
    "[class*='product-item']",
    "[class*='ProductCard']",
    ".card",
    "[data-product-id]",
  ];

  let cards = [];
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found.length >= 2) { cards = Array.from(found); break; }
  }

  return cards.map((card) => {
    const nameEl  = card.querySelector("h2, h3, h4, [class*='title'], [class*='name'], [class*='product-name']");
    const linkEl  = card.querySelector("a[href]");
    const imgEl   = card.querySelector("img");
    const priceEl = card.querySelector("[class*='price']:not([class*='old']):not([class*='was']):not([class*='regular'])");
    const origEl  = card.querySelector("del, s, [class*='old-price'], [class*='was'], [class*='regular-price']");
    const discEl  = card.querySelector("[class*='discount'], [class*='off'], [class*='badge'], [class*='tag']");

    const name = nameEl?.textContent?.trim() || "";
    if (!name) return null;

    return {
      name,
      price:         clean(priceEl?.textContent),
      originalPrice: clean(origEl?.textContent),
      discount:      discEl?.textContent?.trim() || null,
      imageUrl:      imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazySrc || "",
      productUrl:    linkEl?.href || "",
    };
  }).filter((p) => p && p.name);
}

// ─── Core scrape function ─────────────────────────────────────────────────────
async function scrapeUrl(url) {
  const page = await newPage();
  try {
    const { captured, handler } = attachXhrCapture(page);

    await navigateTo(page, url);
    await sleep(JS_WAIT); // extra wait for JS-rendered product cards

    page.off("response", handler);

    // XHR products take priority
    if (captured.length > 0) {
      return captured.map(normalizeProduct).filter((p) => p.name);
    }

    // DOM fallback
    const dom = await page.evaluate(extractFromDom);
    return dom.map((p) => ({ ...p, source: SOURCE_NAME, category: "Clothing" }));
  } finally {
    page.removeAllListeners("response");
    await page.close().catch(() => {});
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function scrapeFabrilife(listingUrl = `${BASE_URL}/products`, pages = 1) {
  const results = [];
  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? listingUrl : `${listingUrl}${listingUrl.includes("?") ? "&" : "?"}page=${p}`;
    try {
      const products = await scrapeUrl(url);
      if (products.length === 0) break;
      results.push(...products);
    } catch (err) {
      console.warn(`[fabrilife] scrapeFabrilife p${p} failed: ${err.message}`);
      break;
    }
  }
  return results;
}

async function searchFabrilife(keyword, pages = 1) {
  const results = [];
  for (let p = 1; p <= pages; p++) {
    // Fabrilife uses /products?search=<keyword>&page=N
    const url = `${BASE_URL}/products?search=${encodeURIComponent(keyword)}${p > 1 ? `&page=${p}` : ""}`;
    try {
      const products = await scrapeUrl(url);
      if (products.length === 0) break;
      results.push(...products);
    } catch (err) {
      console.warn(`[fabrilife] searchFabrilife p${p} failed: ${err.message}`);
      break;
    }
  }
  return results;
}

async function getFabrilifeCategories() {
  const page = await newPage();
  try {
    await navigateTo(page, BASE_URL);
    await sleep(1000);
    return page.evaluate(() => {
      const links = document.querySelectorAll("nav a, .navbar a, [class*='menu'] a, [class*='category'] a");
      return Array.from(links)
        .map((a) => ({ name: a.textContent.trim(), url: a.href }))
        .filter((c) => c.name && c.url.includes("fabrilife.com") && c.name.length > 1);
    });
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { scrapeFabrilife, getFabrilifeCategories, searchFabrilife };
