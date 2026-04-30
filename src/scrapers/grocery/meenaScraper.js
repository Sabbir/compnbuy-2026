/**
 * meenaScraper.js
 * Scrapes product data from meenabazaronline.com
 *
 * Architecture: WooCommerce shop with possible custom theme.
 * Uses WooCommerce REST API first, falls back to DOM parsing.
 * MeenaBazaar is a well-known Bangladeshi supermarket chain.
 */

const { newPage } = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");

const BASE_URL    = "https://meenabazaronline.com";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "meenabazaar";

// ─── WooCommerce REST API ─────────────────────────────────────────────────────

async function tryWooApi(page, params = {}) {
  const qs = new URLSearchParams({
    per_page: 30,
    page: 1,
    ...params,
  }).toString();

  const endpoints = [
    `${BASE_URL}/wp-json/wc/store/v1/products?${qs}`,
    `${BASE_URL}/wp-json/wc/v3/products?${qs}`,  // needs auth but try anyway
    `${BASE_URL}/?wc-ajax=get_refreshed_fragments`,
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await page.evaluate(async (url) => {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) return null;
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("json")) return null;
        return r.json();
      }, endpoint);

      if (Array.isArray(data) && data.length > 0) {
        return data.map(normalizeWooProduct);
      }
    } catch { /* skip */ }
  }

  return null;
}

function normalizeWooProduct(p) {
  // WooCommerce Store API prices are in minor units (paisa), divide by 100
  const rawPrice = p.prices?.price ?? p.price ?? "0";
  const rawOrig  = p.prices?.regular_price ?? p.regular_price ?? rawPrice;
  const divisor  = String(rawPrice).length > 6 ? 100 : 1; // detect minor units

  const price     = parseFloat(rawPrice) / divisor || null;
  const origPrice = parseFloat(rawOrig)  / divisor || null;

  return {
    name:          p.name                          || "",
    price:         price,
    originalPrice: origPrice !== price ? origPrice : null,
    discount:      p.on_sale ? (p.prices?.price_range || "On Sale") : null,
    unit:          p.weight || p.dimensions?.length || null,
    imageUrl:      p.images?.[0]?.src              || "",
    productUrl:    p.permalink                      || `${BASE_URL}/?p=${p.id}`,
    sku:           p.sku                            || null,
    inStock:       p.is_in_stock                   ?? true,
    categories:    (p.categories || []).map((c) => c.name).join(", ") || "Grocery",
    rating:        p.average_rating                 || null,
    reviewCount:   p.review_count                   || null,
  };
}

// ─── DOM Extractor ────────────────────────────────────────────────────────────

function extractWooProducts() {
  const cleanPrice = (raw) => {
    if (!raw) return null;
    const n = parseFloat(raw.replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  const selectors = [
    "ul.products li.product",
    ".woocommerce-loop-product",
    ".product-grid-item",
    "[class*='product-item']",
    ".product",
  ];

  let cards = [];
  for (const sel of selectors) {
    cards = document.querySelectorAll(sel);
    if (cards.length > 2) break;
  }

  return Array.from(cards).map((card) => {
    const nameEl    = card.querySelector(
      ".woocommerce-loop-product__title, .product-title, h2, h3, h4"
    );
    const priceIns  = card.querySelector("ins .woocommerce-Price-amount");
    const priceDef  = card.querySelector(".price > .woocommerce-Price-amount, .woocommerce-Price-amount");
    const origEl    = card.querySelector("del .woocommerce-Price-amount");
    const imgEl     = card.querySelector("img");
    const linkEl    = card.querySelector("a.woocommerce-loop-product__link, a");
    const badgeEl   = card.querySelector(".onsale, .badge, [class*='discount']");
    const unitEl    = card.querySelector("[class*='unit'], [class*='weight'], .unit");

    const name = nameEl?.textContent?.trim() || "";
    if (!name) return null;

    return {
      name,
      price:         cleanPrice((priceIns || priceDef)?.textContent),
      originalPrice: cleanPrice(origEl?.textContent),
      discount:      badgeEl?.textContent?.trim() || null,
      unit:          unitEl?.textContent?.trim()  || null,
      imageUrl:      imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazySrc || "",
      productUrl:    linkEl?.href || "",
    };
  }).filter(Boolean);
}

// ─── Category extractor ───────────────────────────────────────────────────────

function extractCategories() {
  const links = document.querySelectorAll(
    ".product-categories a, .widget_product_categories a, nav.woocommerce-breadcrumb a, .shop-categories a"
  );
  return Array.from(links).map((a) => ({
    name: a.textContent.trim(),
    url:  a.href,
  })).filter((c) => c.name && c.url.includes(BASE_URL));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape MeenaBazaar products.
 * @param {string} shopUrl  e.g. "https://meenabazaronline.com/shop"
 * @param {number} pages
 */
async function scrapeMeena(shopUrl = `${BASE_URL}/shop`, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    await navigateTo(page, shopUrl);

    // Try WooCommerce API first
    const apiResults = await tryWooApi(page);

    if (apiResults && apiResults.length > 0) {
      results.push(...apiResults);

      for (let p = 2; p <= pages; p++) {
        const more = await tryWooApi(page, { page: p });
        if (!more || more.length === 0) break;
        results.push(...more);
        await sleep(DELAY);
      }
    } else {
      // DOM fallback
      for (let p = 1; p <= pages; p++) {
        const url = p === 1 ? shopUrl : `${shopUrl}/page/${p}/`;
        if (p > 1) await navigateTo(page, url);
        await autoScroll(page);
        const products = await page.evaluate(extractWooProducts);
        if (products.length === 0) break;
        results.push(...products);
        await sleep(DELAY);
      }
    }
  } finally {
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Grocery" }));
}

/**
 * Get all category links from the homepage/shop page.
 * @returns {Promise<{name: string, url: string}[]>}
 */
async function getMeenaCategories() {
  const page = await newPage();
  try {
    await navigateTo(page, `${BASE_URL}/shop`);
    return await page.evaluate(extractCategories);
  } finally {
    await page.close();
  }
}


// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Search MeenaBazaar by keyword.
 * WooCommerce search: /?s=<keyword>&post_type=product
 * Also probes the WooCommerce Store API search param.
 * @param {string} keyword
 * @param {number} pages
 */
async function searchMeena(keyword, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    const searchUrl = `${BASE_URL}/wp-json/wc/store/v1/products?search=${encodeURIComponent(keyword)}&per_page=30`;
    await navigateTo(page, `${BASE_URL}/?s=${encodeURIComponent(keyword)}&post_type=product`);

    // 1. Try WooCommerce Store API search
    const apiData = await page.evaluate(async (url) => {
      try {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) return null;
        return r.json();
      } catch { return null; }
    }, searchUrl);

    if (Array.isArray(apiData) && apiData.length > 0) {
      results.push(...apiData.map(normalizeWooProduct));

      for (let p = 2; p <= pages; p++) {
        const more = await page.evaluate(async (url) => {
          try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; }
        }, searchUrl + `&page=${p}`);
        if (!Array.isArray(more) || more.length === 0) break;
        results.push(...more.map(normalizeWooProduct));
        await sleep(DELAY);
      }
    } else {
      // 2. DOM fallback — same WooCommerce product grid used for search results
      await autoScroll(page);
      const dom = await page.evaluate(extractWooProducts);
      results.push(...dom);

      for (let p = 2; p <= pages; p++) {
        const url = `${BASE_URL}/page/${p}/?s=${encodeURIComponent(keyword)}&post_type=product`;
        await navigateTo(page, url);
        await autoScroll(page);
        const more = await page.evaluate(extractWooProducts);
        if (more.length === 0) break;
        results.push(...more);
        await sleep(DELAY);
      }
    }
  } finally {
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Grocery" }));
}

module.exports = { scrapeMeena, getMeenaCategories, searchMeena };
