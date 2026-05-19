/**
 * lereveScraper.js
 * Scrapes product data from lerevecraze.com
 *
 * Platform : WooCommerce on WordPress
 * Browse URL: https://www.lerevecraze.com/product-category/panjabi/
 * Search URL: https://www.lerevecraze.com/?s=<keyword>&post_type=product
 *
 * Strategy:
 *  1. WooCommerce Store REST API  → /wp-json/wc/store/v1/products
 *  2. DOM fallback on WC product list markup (li.product, .woocommerce-loop-product__title)
 *
 * Pagination: ?page=2 (WP standard) or API currentPage param
 */

const { newPage }                       = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");
const { injectSafeFetch }               = require("../../utils/safeFetch");

const BASE_URL    = "https://www.lerevecraze.com";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "lerevecraze";

// ─── WooCommerce Store API normalizer ─────────────────────────────────────────

function normalizeWooProduct(p) {
  const price     = parseFloat(p.prices?.price)         / 100 || null;
  const origPrice = parseFloat(p.prices?.regular_price) / 100 || null;

  const imageUrl = p.images?.[0]?.src || "";

  return {
    name:          p.name || "",
    price,
    originalPrice: origPrice && origPrice > price ? origPrice : null,
    discount:      origPrice && price && origPrice > price
      ? `-${Math.round((1 - price / origPrice) * 100)}%`
      : null,
    unit:          null,
    sku:           p.sku || null,
    imageUrl:      imageUrl.startsWith("//") ? "https:" + imageUrl : imageUrl,
    productUrl:    p.permalink || "",
    inStock:       p.is_in_stock ?? true,
  };
}

// ─── WooCommerce Store API fetch helper ───────────────────────────────────────

async function fetchWooProducts(page, params = {}) {
  const qs = new URLSearchParams({
    per_page: 24,
    page:     1,
    ...params,
  }).toString();

  const url  = `${BASE_URL}/wp-json/wc/store/v1/products?${qs}`;
  const data = await page.evaluate(async (endpoint) => {
    try {
      const r    = await fetch(endpoint, { headers: { Accept: "application/json" } });
      const text = await r.text();
      const first = text.trimStart()[0];
      if (first !== "[" && first !== "{") return null;
      return JSON.parse(text);
    } catch { return null; }
  }, url);

  return Array.isArray(data) ? data : data?.products || null;
}

// ─── WooCommerce DOM extractor ────────────────────────────────────────────────

function extractWooProducts() {
  const cleanPrice = (raw) => {
    const n = parseFloat((raw || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  // WooCommerce standard product list selectors
  let cards = document.querySelectorAll(".lrv-product-grid");
  if (!cards.length) cards = document.querySelectorAll(".products li");
  if (!cards.length) cards = document.querySelectorAll("article.product");
  if (!cards.length) cards = document.querySelectorAll("[class*='product-item']");

  return Array.from(cards).map((card) => {
    const nameEl   = card.querySelector(
      ".text-truncate a"
    );
    const linkEl   = card.querySelector("a.woocommerce-loop-product__link, a");
    const priceEl  = card.querySelector("ins .woocommerce-Price-amount, .price ins, .price > .amount");
    const origEl   = card.querySelector("del .woocommerce-Price-amount, .price del");
    const anyPrice = card.querySelector(".woocommerce-Price-amount, .price .amount, .price");
    const imgEl    = card.querySelector("img");
    const badgeEl  = card.querySelector(".onsale, [class*='badge'], [class*='sale']");

    const name = nameEl?.textContent?.trim() || "";
    if (!name) return null;

    const price    = cleanPrice(priceEl?.textContent  || anyPrice?.textContent);
    const origPrice = cleanPrice(origEl?.textContent);

    return {
      name,
      price,
      originalPrice: origPrice && origPrice > price ? origPrice : null,
      discount:      badgeEl?.textContent?.trim()
        || (origPrice && price && origPrice > price
          ? `-${Math.round((1 - price / origPrice) * 100)}%`
          : null),
      unit:      null,
      imageUrl:  imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazySrc || "",
      productUrl: linkEl?.href || "",
    };
  }).filter(Boolean);
}

// ─── Browse ───────────────────────────────────────────────────────────────────

async function scrapeLeReve(categoryUrl = `${BASE_URL}/product-category/panjabi/`, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    await injectSafeFetch(page);
    await navigateTo(page, categoryUrl);

    // Strategy 1 — WooCommerce Store API with category slug
    const slug    = categoryUrl.match(/product-category\/([^/]+)/)?.[1] || "";
    const apiData = await fetchWooProducts(page, { category: slug, page: 1 });

    if (apiData && apiData.length > 0) {
      results.push(...apiData.map(normalizeWooProduct));
      for (let p = 2; p <= pages; p++) {
        const more = await fetchWooProducts(page, { category: slug, page: p });
        if (!more || !more.length) break;
        results.push(...more.map(normalizeWooProduct));
        await sleep(DELAY);
      }
    } else {
      // Strategy 2 — DOM
      await autoScroll(page);
      const dom = await page.evaluate(extractWooProducts);
      results.push(...dom);

      for (let p = 2; p <= pages; p++) {
        const sep = categoryUrl.includes("?") ? "&" : "?";
        await navigateTo(page, `${categoryUrl}${sep}page=${p}`);
        await autoScroll(page);
        const more = await page.evaluate(extractWooProducts);
        if (!more.length) break;
        results.push(...more);
        await sleep(DELAY);
      }
    }
  } finally {
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Clothing" }));
}

// ─── Search ───────────────────────────────────────────────────────────────────

async function searchLeReve(keyword, pages = 1) {
  if (!keyword?.trim()) return [];

  const page    = await newPage();
  const results = [];

  try {
    await injectSafeFetch(page);

    // Navigate to WP product search URL
    const searchUrl = `${BASE_URL}/product-category/${encodeURIComponent(keyword.trim())}/`;
    await navigateTo(page, searchUrl);
    await autoScroll(page);
    await sleep(800);
    console.log(searchUrl)

    // Strategy 1 — WooCommerce Store API with search param
    const apiData = await fetchWooProducts(page, { search: keyword.trim(), page: 1 });

    if (apiData && apiData.length > 0) {
      results.push(...apiData.map(normalizeWooProduct));
      for (let p = 2; p <= pages; p++) {
        const more = await fetchWooProducts(page, { search: keyword.trim(), page: p });
        if (!more || !more.length) break;
        results.push(...more.map(normalizeWooProduct));
        await sleep(DELAY);
      }
    } else {
      // Strategy 2 — DOM fallback on search results page
      const dom = await page.evaluate(extractWooProducts);
      results.push(...dom);

      for (let p = 2; p <= pages; p++) {
        await navigateTo(page, `${searchUrl}&paged=${p}`);
        await autoScroll(page);
        const more = await page.evaluate(extractWooProducts);
        if (!more.length) break;
        results.push(...more);
        await sleep(DELAY);
      }
    }
  } finally {
    await page.close();
  }

  // Deduplicate by name
  const seen = new Set();
  return results
    .filter((p) => {
      if (!p.name) return false;
      const k = p.name.toLowerCase().trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((p) => ({ ...p, source: SOURCE_NAME, category: "Clothing" }));
}

// ─── Categories ───────────────────────────────────────────────────────────────

async function getLeReveCategories() {
  const page = await newPage();
  try {
    await navigateTo(page, BASE_URL);
    const cats = await page.evaluate(async () => {
      // Try WC Store API
      try {
        const r    = await fetch("/wp-json/wc/store/v1/products/categories?per_page=50");
        const data = await r.json();
        if (Array.isArray(data)) {
          return data.map((c) => ({
            name:  c.name,
            slug:  c.slug,
            count: c.count,
            url:   `${location.origin}/product-category/${c.slug}/`,
          }));
        }
      } catch {}

      // DOM fallback — nav/menu links
      const links = document.querySelectorAll(
        ".product-categories a, .widget_product_categories a, nav a, .navbar a"
      );
      return Array.from(links)
        .map((a) => ({ name: a.textContent.trim(), url: a.href }))
        .filter((c) => c.name && c.url.includes("lerevecraze.com"));
    });
    return cats;
  } finally {
    await page.close();
  }
}

module.exports = { scrapeLeReve, searchLeReve, getLeReveCategories };
