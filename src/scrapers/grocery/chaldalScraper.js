/**
 * chaldalScraper.js
 * Scrapes product data from chaldal.com
 *
 * Platform : React SPA (Angular-based frontend)
 * Search URL: https://chaldal.com/search/<keyword>   (path-based, NOT ?q=)
 * Browse URL: https://chaldal.com/<category>          e.g. /fruit, /dairy
 *
 * Strategy:
 *  1. XHR/Fetch interception — Chaldal's React app calls an internal JSON
 *     API on every page load. We capture those responses before DOM rendering.
 *  2. DOM fallback — parse rendered .product cards if interception returns nothing.
 *
 * All response.text() calls are guarded: HTML pages (starting with "<")
 * are silently discarded to prevent "Unexpected token '<'" JSON parse errors.
 */

const { newPage } = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");
const { injectSafeFetch } = require("../../utils/safeFetch");

const BASE_URL    = "https://chaldal.com";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "chaldal";

// ─── Safe JSON parse ──────────────────────────────────────────────────────────

function safeParseJson(text) {
  try {
    const t = (text || "").trimStart();
    if (t[0] !== "{" && t[0] !== "[") return null;
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// ─── XHR / Fetch Interception ────────────────────────────────────────────────

/**
 * Navigate to a URL, capture all JSON network responses that look like
 * product data, then scroll to trigger any lazy-loaded content.
 */
async function interceptProducts(page, url) {
  const captured = [];

  const handler = async (response) => {
    try {
      const resUrl = response.url();
      const status = response.status();

      // Only consider successful responses
      if (status < 200 || status >= 300) return;

      const ct = response.headers()["content-type"] || "";

      // Filter to likely product API calls
      const isProductApi =
        ct.includes("json") ||
        resUrl.includes("/api/") ||
        resUrl.includes("product") ||
        resUrl.includes("search") ||
        resUrl.includes("catalog");

      if (!isProductApi) return;

      const text = await response.text().catch(() => "");
      const json = safeParseJson(text);
      if (!json) return;

      // Chaldal returns various shapes — try all common keys
      const items =
        json.products                         ||
        json.data?.products                   ||
        json.data                             ||
        json.items                            ||
        json.results                          ||
        json.searchResult?.products           ||
        json.searchResult                     ||
        (Array.isArray(json) ? json : null);

      if (Array.isArray(items) && items.length > 0) {
        captured.push(...items);
      }
    } catch { /* silently skip */ }
  };

  page.on("response", handler);

  try {
    await navigateTo(page, url);
    await autoScroll(page);
    // Wait for async XHR calls to complete after scroll
    await sleep(2000);
  } finally {
    page.off("response", handler);
  }

  return captured;
}

// ─── DOM Extractor ────────────────────────────────────────────────────────────

function extractFromDom() {
  const cleanPrice = (raw) => {
    const n = parseFloat((raw || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  // Chaldal's React DOM uses these class patterns for product cards
  const selectors = [
    ".product",
    "[class*='productItem']",
    "[class*='ProductCard']",
    "[class*='product-card']",
    "[class*='item']",
  ];

  let cards = [];
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 1) { cards = found; break; }
  }

  return Array.from(cards).map((card) => {
    const nameEl  = card.querySelector(
      "[class*='name'], [class*='title'], [class*='Name'], h3, h4, h2"
    );
    const priceEl = card.querySelector(
      "[class*='price']:not([class*='old']):not([class*='del']):not([class*='strike'])"
    );
    const origEl  = card.querySelector(
      "[class*='old'], [class*='strike'], [class*='market'], del, s"
    );
    const imgEl   = card.querySelector("img");
    const linkEl  = card.querySelector("a");
    const unitEl  = card.querySelector(
      "[class*='unit'], [class*='weight'], [class*='size'], [class*='qty']"
    );
    const badgeEl = card.querySelector(
      "[class*='discount'], [class*='off'], [class*='badge'], [class*='tag']"
    );

    const name = nameEl?.textContent?.trim() || nameEl?.getAttribute("title") || "";
    if (!name) return null;

    return {
      name,
      price:         cleanPrice(priceEl?.textContent),
      originalPrice: cleanPrice(origEl?.textContent),
      discount:      badgeEl?.textContent?.trim() || null,
      unit:          unitEl?.textContent?.trim()  || null,
      imageUrl:      imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazySrc || "",
      productUrl:    linkEl?.href
        ? (linkEl.href.startsWith("http") ? linkEl.href : "https://chaldal.com" + linkEl.href)
        : "",
    };
  }).filter(Boolean);
}

// ─── Normalizer for intercepted API data ─────────────────────────────────────

function normalizeApiProduct(p) {
  // Chaldal API uses various field name casings
  const price     = p.price       ?? p.Price       ?? p.discountedPrice ?? p.salePrice    ?? null;
  const origPrice = p.marketPrice ?? p.MarketPrice ?? p.originalPrice   ?? p.regularPrice ?? null;

  const imageUrl =
    p.imageUrl   || p.ImageUrl   ||
    p.image      || p.Image      ||
    p.imageUrls?.[0] || p.images?.[0] || "";

  const productUrl = p.url || p.slug
    ? `${BASE_URL}${p.url || "/product/" + p.slug}`
    : "";

  return {
    name:          p.name         || p.Name         || p.productName || p.title || "",
    price:         typeof price === "number"     ? price     : parseFloat(String(price || ""))     || null,
    originalPrice: typeof origPrice === "number" ? origPrice : parseFloat(String(origPrice || "")) || null,
    discount:      p.discountText || p.discount      || p.discountPercentage
      ? (p.discountText || p.discount || `-${p.discountPercentage}%`)
      : null,
    unit:          p.unit    || p.Unit    || p.weight || p.unitOfMeasure || null,
    imageUrl:      imageUrl.startsWith("//") ? "https:" + imageUrl : imageUrl,
    productUrl,
    inStock:       p.inStock ?? p.IsAvailable ?? p.available ?? true,
  };
}

// ─── Browse (category page) ───────────────────────────────────────────────────

/**
 * Scrape a Chaldal category page.
 * @param {string} categoryUrl  e.g. "https://chaldal.com/fruit"
 * @param {number} pages
 */
async function scrapeChaldal(categoryUrl = BASE_URL, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    // evaluateOnNewDocument so safeFetch survives every navigation
    await injectSafeFetch(page);

    for (let p = 1; p <= pages; p++) {
      const url      = p === 1 ? categoryUrl : `${categoryUrl}?page=${p}`;
      const captured = await interceptProducts(page, url);

      if (captured.length > 0) {
        results.push(...captured.map(normalizeApiProduct));
      } else {
        const dom = await page.evaluate(extractFromDom);
        if (dom.length === 0 && p > 1) break; // no more pages
        results.push(...dom);
      }

      if (p < pages) await sleep(DELAY);
    }
  } finally {
    await page.close();
  }

  return results
    .filter((p) => p.name)
    .map((p) => ({ ...p, source: SOURCE_NAME, category: "Grocery" }));
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Search Chaldal products by keyword.
 *
 * Chaldal search URL pattern: https://chaldal.com/search/<keyword>
 * e.g. https://chaldal.com/search/eggs
 *      https://chaldal.com/search/milk
 *
 * The search results are loaded via the same XHR interception as browse pages.
 *
 * @param {string} keyword  e.g. "eggs", "milk", "rice"
 * @param {number} pages
 */
async function searchChaldal(keyword, pages = 1) {
  if (!keyword || !keyword.trim()) {
    throw new Error("keyword is required for searchChaldal");
  }

  // Chaldal uses path-based search: /search/<keyword>
  // Spaces become dashes or are URL-encoded
  const slug    = keyword.trim().toLowerCase().replace(/\s+/g, "-");
  const page    = await newPage();
  const results = [];

  try {
    await injectSafeFetch(page);

    for (let p = 1; p <= pages; p++) {
      // Page 1: /search/eggs
      // Page 2+: Chaldal doesn't appear to paginate search, but we include the param just in case
      const url = p === 1
        ? `${BASE_URL}/search/${encodeURIComponent(slug)}`
        : `${BASE_URL}/search/${encodeURIComponent(slug)}?page=${p}`;

      const captured = await interceptProducts(page, url);

      if (captured.length > 0) {
        results.push(...captured.map(normalizeApiProduct));
      } else {
        const dom = await page.evaluate(extractFromDom);
        if (dom.length === 0) break;
        results.push(...dom);
      }

      if (p < pages) await sleep(DELAY);
    }
  } finally {
    await page.close();
  }

  return results
    .filter((p) => p.name)
    .map((p) => ({ ...p, source: SOURCE_NAME, category: "Grocery", query: keyword.trim() }));
}

module.exports = { scrapeChaldal, searchChaldal };
