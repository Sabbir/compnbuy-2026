/**
 * vertechScraper.js
 * Scrapes product data from vertech.com.bd
 *
 * Platform: WooCommerce (Bangladeshi electronics/tech retailer)
 * Strategy:
 *  1. WooCommerce Store API: /wp-json/wc/store/v1/products (public, no auth)
 *  2. WooCommerce REST API: /wp-json/wc/v3/products
 *  3. DOM fallback: standard WooCommerce HTML grid + custom theme selectors
 *
 * Pagination: ?page=N (API) or /page/N/ (DOM)
 * Shop URL: /shop or category URLs
 */

const { newPage }                      = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");

const BASE_URL    = "https://www.vertech.com.bd";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "vertech";

// ─── WooCommerce Store API ────────────────────────────────────────────────────

async function fetchWooPage(page, endpoint, params = {}) {
  const qs  = new URLSearchParams({ per_page: 30, ...params }).toString();
  const url = `${BASE_URL}${endpoint}?${qs}`;

  return page.evaluate(async (apiUrl) => {
    try {
      const r = await fetch(apiUrl, { headers: { Accept: "application/json" } });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) return null;
      return r.json();
    } catch { return null; }
  }, url);
}

function normalizeWooProduct(p) {
  const rawPrice  = p.prices?.price         ?? p.price         ?? "0";
  const rawOrig   = p.prices?.regular_price  ?? p.regular_price ?? rawPrice;

  // Detect if prices are in minor units (paisa) — WooCommerce Store API quirk
  const divisor   = String(rawPrice).replace(/\D/g, "").length > 6 ? 100 : 1;
  const price     = parseFloat(rawPrice) / divisor || null;
  const origPrice = parseFloat(rawOrig)  / divisor || null;

  // Attributes: sizes, storage, RAM, etc.
  const attrs = p.attributes || [];
  const findAttr = (...names) => {
    const attr = attrs.find((a) => names.some((n) => new RegExp(n, "i").test(a.name || a.slug || "")));
    if (!attr) return null;
    const vals = attr.terms || attr.options || [];
    return Array.isArray(vals) ? vals.map((v) => v.name || v).filter(Boolean) : null;
  };

  return {
    name:          p.name             || "",
    price,
    originalPrice: origPrice !== price ? origPrice : null,
    discount:      p.on_sale
      ? (origPrice && price ? `-${Math.round((1 - price / origPrice) * 100)}%` : "On Sale")
      : null,
    sku:           p.sku              || null,
    imageUrl:      p.images?.[0]?.src || "",
    productUrl:    p.permalink        || `${BASE_URL}/?p=${p.id}`,
    inStock:       p.is_in_stock      ?? true,
    stockQuantity: p.stock_quantity   ?? null,
    brand:         p.brands?.[0]?.name || findAttr("brand", "manufacturer")?.[0] || null,
    storage:       findAttr("storage", "capacity", "hdd", "ssd"),
    ram:           findAttr("ram", "memory"),
    productType:   p.categories?.[0]?.name || null,
    rating:        p.average_rating   || null,
    reviewCount:   p.review_count     || null,
  };
}

// ─── DOM Extractor ────────────────────────────────────────────────────────────

function extractWooProducts() {
  const cleanPrice = (raw) => {
    const n = parseFloat((raw || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  const selectors = [
    "ul.products li.product",
    ".products .product",
    ".woocommerce-loop-product",
    "[class*='product-item']",
    "[class*='product-card']",
    ".product",
  ];

  let cards = [];
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 1) { cards = found; break; }
  }

  return Array.from(cards).map((card) => {
    const nameEl    = card.querySelector(
      ".woocommerce-loop-product__title, h2, h3, [class*='product-title'], [class*='name']"
    );
    const priceIns  = card.querySelector("ins .woocommerce-Price-amount");
    const priceDef  = card.querySelector(".price > .woocommerce-Price-amount, .woocommerce-Price-amount");
    const origEl    = card.querySelector("del .woocommerce-Price-amount");
    const badgeEl   = card.querySelector(".onsale, .badge, [class*='discount'], [class*='sale']");
    const imgEl     = card.querySelector("img");
    const linkEl    = card.querySelector("a.woocommerce-loop-product__link, a");
    const brandEl   = card.querySelector("[class*='brand'], .product-brand");

    const name = nameEl?.textContent?.trim() || "";
    if (!name) return null;

    const price     = cleanPrice((priceIns || priceDef)?.textContent);
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
      imageUrl:   imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazySrc || "",
      productUrl: linkEl?.href || "",
    };
  }).filter(Boolean);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape Vertech products.
 * @param {string} shopUrl   e.g. "https://www.vertech.com.bd/shop"
 * @param {number} pages
 */
async function scrapeVertech(shopUrl = `${BASE_URL}/shop`, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    await navigateTo(page, shopUrl);

    // 1. Try WooCommerce Store API
    const storeData = await fetchWooPage(page, "/wp-json/wc/store/v1/products", { page: 1 });

    if (Array.isArray(storeData) && storeData.length > 0) {
      results.push(...storeData.map(normalizeWooProduct));

      for (let p = 2; p <= pages; p++) {
        const more = await fetchWooPage(page, "/wp-json/wc/store/v1/products", { page: p });
        if (!Array.isArray(more) || more.length === 0) break;
        results.push(...more.map(normalizeWooProduct));
        await sleep(DELAY);
      }
    } else {
      // 2. DOM fallback with pagination
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
        if (p < pages) await sleep(DELAY);
      }
    }
  } finally {
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Electronics" }));
}

/**
 * Get WooCommerce product categories for Vertech.
 */
async function getVertechCategories() {
  const page = await newPage();
  try {
    await navigateTo(page, `${BASE_URL}/shop`);

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

    // DOM fallback
    return page.evaluate(() => {
      const links = document.querySelectorAll(
        ".product-categories a, .widget_product_categories a, [class*='category'] a"
      );
      return Array.from(links).map((a) => ({
        name: a.textContent.trim(),
        url:  a.href,
      })).filter((c) => c.name && c.url.includes("vertech.com.bd"));
    });
  } finally {
    await page.close();
  }
}

module.exports = { scrapeVertech, getVertechCategories };
