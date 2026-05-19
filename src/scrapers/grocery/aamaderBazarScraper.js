/**
 * aamaderBazarScraper.js
 * Scrapes product data from aamaderbazar.com
 *
 * Platform : WordPress + WooCommerce
 * Base URL  : https://aamaderbazar.com
 *
 * Search URL : https://aamaderbazar.com/?s=<keyword>&post_type=product
 * Browse URL : https://aamaderbazar.com/product-category/<slug>/
 *
 * DOM structure (confirmed from live HTML):
 *   <ul class="products columns-4">
 *     <li class="product type-product ...">
 *       <a class="woocommerce-LoopProduct-link woocommerce-loop-product__link">
 *         <img class="attachment-woocommerce_thumbnail">
 *         <h2 class="woocommerce-loop-product__title">Product Name</h2>
 *         <span class="price">
 *           <!-- Regular price -->
 *           <span class="woocommerce-Price-amount amount"><bdi>৳ 60.00</bdi></span>
 *           <!-- OR Sale: -->
 *           <del><span class="woocommerce-Price-amount amount"><bdi>৳ 25.00</bdi></span></del>
 *           <ins><span class="woocommerce-Price-amount amount"><bdi>৳ 22.00</bdi></span></ins>
 *       </a>
 *
 * WC Store API: /wp-json/wc/store/v1/products?search=<keyword>&per_page=24
 *
 * Pagination: ?paged=2 (WP standard for search), ?page=2 for category pages
 */

const { newPage }                       = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");
const { injectSafeFetch }               = require("../../utils/safeFetch");

const BASE_URL    = "https://aamaderbazar.com";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "aamaderbazar";

// ─── WooCommerce Store API normalizer ─────────────────────────────────────────

function normalizeWooProduct(p) {
  // WC Store API returns prices in minor units (multiply ×100)
  const rawPrice    = parseFloat(p.prices?.price);
  const rawOriginal = parseFloat(p.prices?.regular_price);

  const price     = rawPrice    ? rawPrice    / 100 : null;
  const origPrice = rawOriginal ? rawOriginal / 100 : null;

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

// ─── DOM extractor (matches confirmed HTML structure) ─────────────────────────

function extractWooProducts() {
  const cleanPrice = (raw) => {
    const n = parseFloat((raw || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  // Primary selector confirmed from HTML: li.product.type-product
  let cards = document.querySelectorAll("li.product.type-product");
  if (!cards.length) cards = document.querySelectorAll("li.product");
  if (!cards.length) cards = document.querySelectorAll("ul.products li");

  return Array.from(cards).map((card) => {
    // Name: h2.woocommerce-loop-product__title (confirmed from HTML)
    const nameEl   = card.querySelector("h2.woocommerce-loop-product__title");
    const name     = nameEl?.textContent?.trim() || "";
    if (!name) return null;

    // Link: a.woocommerce-LoopProduct-link or a.woocommerce-loop-product__link
    const linkEl     = card.querySelector(
      "a.woocommerce-LoopProduct-link, a.woocommerce-loop-product__link"
    );
    const productUrl = linkEl?.href || "";

    // Image: img.attachment-woocommerce_thumbnail (confirmed from HTML)
    const imgEl    = card.querySelector("img.attachment-woocommerce_thumbnail, img");
    const imageUrl = imgEl?.src
                  || imgEl?.getAttribute("data-src")
                  || imgEl?.getAttribute("data-lazy-src")
                  || imgEl?.getAttribute("srcset")?.split(" ")?.[0]
                  || "";

    // Price extraction (handles both regular and sale price)
    // Sale: <del> contains original, <ins> contains sale price
    const salePriceEl  = card.querySelector("ins .woocommerce-Price-amount");
    const origPriceEl  = card.querySelector("del .woocommerce-Price-amount");
    const regPriceEl   = card.querySelector(".price > .woocommerce-Price-amount, .price > span.amount");
    const anyPriceEl   = card.querySelector(".woocommerce-Price-amount");

    const price     = cleanPrice(
      salePriceEl?.textContent || regPriceEl?.textContent || anyPriceEl?.textContent
    );
    const origPrice = cleanPrice(origPriceEl?.textContent);

    // Sale badge: <span class="onsale">Sale!</span>
    const badgeEl  = card.querySelector("span.onsale");
    const discount = badgeEl?.textContent?.trim()
      || (origPrice && price && origPrice > price
        ? `-${Math.round((1 - price / origPrice) * 100)}%`
        : null);

    return {
      name,
      price,
      originalPrice: origPrice && origPrice > price ? origPrice : null,
      discount,
      unit:      null,
      imageUrl:  imageUrl.startsWith("//") ? "https:" + imageUrl : imageUrl,
      productUrl,
    };
  }).filter(Boolean);
}

// ─── WooCommerce Store API helper ─────────────────────────────────────────────

async function fetchWooProducts(page, params = {}) {
  const qs  = new URLSearchParams({ per_page: 24, page: 1, ...params }).toString();
  const url = `${BASE_URL}/wp-json/wc/store/v1/products?${qs}`;

  const data = await page.evaluate(async (endpoint) => {
    try {
      const r    = await fetch(endpoint, { headers: { Accept: "application/json" } });
      const text = await r.text();
      const ch   = text.trimStart()[0];
      if (ch !== "[" && ch !== "{") return null;
      return JSON.parse(text);
    } catch { return null; }
  }, url);

  return Array.isArray(data) ? data : data?.products || null;
}

// ─── Browse (category page) ───────────────────────────────────────────────────

async function scrapeAamaderBazar(
  categoryUrl = `${BASE_URL}/product-category/cooking-essentials/`,
  pages = 1
) {
  const page    = await newPage();
  const results = [];

  try {
    await injectSafeFetch(page);
    await navigateTo(page, categoryUrl);

    const slug    = categoryUrl.match(/product-category\/([^/]+)/)?.[1] || "";
    const apiData = await fetchWooProducts(page, { category: slug });

    if (apiData?.length) {
      results.push(...apiData.map(normalizeWooProduct));
      for (let p = 2; p <= pages; p++) {
        const more = await fetchWooProducts(page, { category: slug, page: p });
        if (!more?.length) break;
        results.push(...more.map(normalizeWooProduct));
        await sleep(DELAY);
      }
    } else {
      // DOM fallback
      await autoScroll(page);
      results.push(...(await page.evaluate(extractWooProducts)));

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

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Grocery" }));
}

// ─── Search ───────────────────────────────────────────────────────────────────

async function searchAamaderBazar(keyword, pages = 1) {
  if (!keyword?.trim()) return [];

  const page    = await newPage();
  const results = [];

  try {
    await injectSafeFetch(page);

    // Confirmed search URL from HTML:
    // /?s=onion&post_type=product
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(keyword.trim())}&post_type=product`;
    await navigateTo(page, searchUrl);
    await autoScroll(page);
    await sleep(800);

    // Strategy 1: WooCommerce Store API search
    const apiData = await fetchWooProducts(page, {
      search: keyword.trim(), page: 1,
    });

    if (apiData?.length) {
      results.push(...apiData.map(normalizeWooProduct));
      for (let p = 2; p <= pages; p++) {
        const more = await fetchWooProducts(page, { search: keyword.trim(), page: p });
        if (!more?.length) break;
        results.push(...more.map(normalizeWooProduct));
        await sleep(DELAY);
      }
    } else {
      // Strategy 2: DOM fallback on WP search results page
      // Confirmed selector: li.product.type-product inside ul.products
      const dom = await page.evaluate(extractWooProducts);
      results.push(...dom);

      for (let p = 2; p <= pages; p++) {
        // WP search pagination uses ?paged=N
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
    .map((p) => ({ ...p, source: SOURCE_NAME, category: "Grocery" }));
}

// ─── Categories ───────────────────────────────────────────────────────────────

async function getAamaderBazarCategories() {
  const page = await newPage();
  try {
    await navigateTo(page, BASE_URL);
    const cats = await page.evaluate(async () => {
      // Try WC Store API first
      try {
        const r    = await fetch("/wp-json/wc/store/v1/products/categories?per_page=100");
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

      // DOM fallback: parse sidebar category list
      // Confirmed from HTML: .widget_product_categories ul.product-categories li.cat-item a
      const links = document.querySelectorAll(
        ".widget_product_categories .product-categories .cat-item a, " +
        ".catalog-menu .cat-nav-menu li a, " +
        ".product-categories li a"
      );
      return Array.from(links).map((a) => ({
        name:  a.textContent.trim(),
        url:   a.href,
        count: parseInt(a.parentElement?.querySelector(".count")?.textContent?.replace(/[()]/g, "") || "0"),
      })).filter((c) => c.name && c.url.includes("aamaderbazar.com"));
    });
    return cats;
  } finally {
    await page.close();
  }
}

module.exports = { scrapeAamaderBazar, searchAamaderBazar, getAamaderBazarCategories };
