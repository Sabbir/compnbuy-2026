/**
 * twelveScraper.js
 * Scrapes product data from twelvebd.com
 *
 * Platform: WooCommerce (Bangladeshi fashion brand "Twelve")
 * Strategy:
 *  1. WooCommerce Store API: /wp-json/wc/store/v1/products (public, no auth)
 *  2. WooCommerce Products API: /wp-json/wc/v3/products
 *  3. DOM fallback: standard WooCommerce HTML product grid
 *
 * Known URL patterns:
 *   /shop                → all products
 *   /product-category/<slug>  → category listing
 *   /shop?page=N         → paginated
 */

const { newPage } = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");

const BASE_URL    = "https://twelvebd.com";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "twelvebd";

// ─── WooCommerce Store API ────────────────────────────────────────────────────

async function fetchWooPage(page, endpoint, params = {}) {
  const qs = new URLSearchParams({ per_page: 30, ...params }).toString();
  const url = `${BASE_URL}${endpoint}?${qs}`;

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

function normalizeWooProduct(p) {
  // WooCommerce Store API prices may be in minor units
  const rawPrice  = p.prices?.price        ?? p.price         ?? "0";
  const rawOrig   = p.prices?.regular_price ?? p.regular_price ?? rawPrice;
  const divisor   = String(rawPrice).replace(".", "").length > 6 ? 100 : 1;

  const price     = parseFloat(rawPrice) / divisor || null;
  const origPrice = parseFloat(rawOrig)  / divisor || null;

  // Extract size/color attributes
  const attrs     = p.attributes || [];
  const sizeAttr  = attrs.find((a) =>
    /size|মাপ/i.test(a.name || a.slug || "")
  );
  const colorAttr = attrs.find((a) =>
    /colo[u]?r|রঙ/i.test(a.name || a.slug || "")
  );

  const toArr = (v) =>
    Array.isArray(v) ? v.map((x) => x.name || x).filter(Boolean)
    : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  return {
    name:          p.name             || "",
    price,
    originalPrice: origPrice !== price ? origPrice : null,
    discount:      p.on_sale
      ? (origPrice && price
        ? `-${Math.round((1 - price / origPrice) * 100)}%`
        : "On Sale")
      : null,
    sku:           p.sku              || null,
    imageUrl:      p.images?.[0]?.src || "",
    productUrl:    p.permalink        || `${BASE_URL}/?p=${p.id}`,
    inStock:       p.is_in_stock      ?? true,
    stockQuantity: p.stock_quantity   ?? null,
    sizes:         toArr(sizeAttr?.terms  || sizeAttr?.options),
    colors:        toArr(colorAttr?.terms || colorAttr?.options),
    productType:   p.categories?.[0]?.name || null,
    tags:          (p.tags || []).map((t) => t.name).join(", ") || null,
    rating:        p.average_rating   || null,
    reviewCount:   p.review_count     || null,
  };
}

// ─── DOM Extractor (WooCommerce standard markup) ─────────────────────────────

function extractWooProducts() {
  const cleanPrice = (raw) => {
    const n = parseFloat((raw || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  const selectors = [
    "ul.products li.product",
    ".products .product",
    ".woocommerce-loop-product",
    "[class*='product-grid'] [class*='product']",
    "[class*='product-item']",
  ];

  let cards = [];
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 2) { cards = found; break; }
  }

  return Array.from(cards).map((card) => {
    const nameEl    = card.querySelector(
      ".woocommerce-loop-product__title, .product-title, h2, h3"
    );
    const priceIns  = card.querySelector("ins .woocommerce-Price-amount");
    const priceDef  = card.querySelector(".price > .woocommerce-Price-amount, .woocommerce-Price-amount");
    const origEl    = card.querySelector("del .woocommerce-Price-amount");
    const badgeEl   = card.querySelector(".onsale, .badge, [class*='discount']");
    const imgEl     = card.querySelector("img");
    const linkEl    = card.querySelector("a.woocommerce-loop-product__link, a");

    const name = nameEl?.textContent?.trim() || "";
    if (!name) return null;

    const price     = cleanPrice((priceIns || priceDef)?.textContent);
    const origPrice = cleanPrice(origEl?.textContent);

    return {
      name,
      price,
      originalPrice: origPrice,
      discount:
        badgeEl?.textContent?.trim() ||
        (origPrice && price
          ? `-${Math.round((1 - price / origPrice) * 100)}%`
          : null),
      imageUrl:  imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazySrc || "",
      productUrl: linkEl?.href || "",
    };
  }).filter(Boolean);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape TwelveBD products.
 * @param {string} shopUrl  e.g. "https://twelvebd.com/shop" or a category URL
 * @param {number} pages
 */
async function scrapeTwelve(shopUrl = `${BASE_URL}/shop`, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    await navigateTo(page, shopUrl);

    // 1. Try WooCommerce Store API
    let apiWorked = false;
    const storeData = await fetchWooPage(page, "/wp-json/wc/store/v1/products", { page: 1 });

    if (Array.isArray(storeData) && storeData.length > 0) {
      results.push(...storeData.map(normalizeWooProduct));
      apiWorked = true;

      for (let p = 2; p <= pages; p++) {
        const more = await fetchWooPage(page, "/wp-json/wc/store/v1/products", { page: p });
        if (!Array.isArray(more) || more.length === 0) break;
        results.push(...more.map(normalizeWooProduct));
        await sleep(DELAY);
      }
    }

    // 2. DOM fallback
    if (!apiWorked) {
      for (let p = 1; p <= pages; p++) {
        const url = p === 1
          ? shopUrl
          : shopUrl.includes("?")
            ? `${shopUrl}&paged=${p}`
            : `${shopUrl}/page/${p}/`;
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

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Clothing" }));
}

/**
 * Get WooCommerce product categories for TwelveBD.
 */
async function getTwelveCategories() {
  const page = await newPage();
  try {
    await navigateTo(page, `${BASE_URL}/shop`);

    // Try WooCommerce categories API
    const cats = await fetchWooPage(page, "/wp-json/wc/store/v1/products/categories", {
      per_page: 50,
    });

    if (Array.isArray(cats) && cats.length > 0) {
      return cats.map((c) => ({
        id:    c.id,
        name:  c.name,
        slug:  c.slug,
        count: c.count,
        url:   `${BASE_URL}/product-category/${c.slug}`,
      }));
    }

    // DOM fallback for categories
    return page.evaluate(() => {
      const links = document.querySelectorAll(
        ".product-categories a, .widget_product_categories a, [class*='category'] a"
      );
      return Array.from(links).map((a) => ({
        name: a.textContent.trim(),
        url:  a.href,
      })).filter((c) => c.name && c.url.includes("twelvebd.com"));
    });
  } finally {
    await page.close();
  }
}


/**
 * Search TwelveBD products by keyword.
 * Uses WooCommerce Store API search param, falls back to WordPress search URL.
 * @param {string} keyword
 * @param {number} pages
 */
async function searchTwelve(keyword, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    // Navigate to WP search first to set context
    await navigateTo(page, `${BASE_URL}/?s=${encodeURIComponent(keyword)}&post_type=product`);

    // Try WooCommerce Store API with search param
    const apiBase = `${BASE_URL}/wp-json/wc/store/v1/products?search=${encodeURIComponent(keyword)}&per_page=30`;
    const first   = await fetchWooPage(page, "/wp-json/wc/store/v1/products", {
      search: keyword, per_page: 30, page: 1,
    });

    if (Array.isArray(first) && first.length > 0) {
      results.push(...first.map(normalizeWooProduct));
      for (let p = 2; p <= pages; p++) {
        const more = await fetchWooPage(page, "/wp-json/wc/store/v1/products", {
          search: keyword, per_page: 30, page: p,
        });
        if (!Array.isArray(more) || more.length === 0) break;
        results.push(...more.map(normalizeWooProduct));
        await sleep(DELAY);
      }
    } else {
      // DOM fallback — WP renders results in same WooCommerce grid
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

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Clothing" }));
}

module.exports = { scrapeTwelve, getTwelveCategories, searchTwelve };
