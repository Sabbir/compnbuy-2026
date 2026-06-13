/**
 * meenaScraper.js
 * Scrapes product data from meenabazaronline.com (WooCommerce)
 */

const { newPage } = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");
const { injectSafeFetch, safeFetchInline } = require("../../utils/safeFetch");

const BASE_URL    = "https://meenabazaronline.com";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "meenabazaar";

// ─── Normalizer ────────────────────────────────────────────────────────────────

function normalizeWooProduct(p) {
  const rawPrice  = p.prices?.price         ?? p.price         ?? "0";
  const rawOrig   = p.prices?.regular_price  ?? p.regular_price ?? rawPrice;
  const divisor   = String(rawPrice).replace(/\D/g, "").length > 5 ? 100 : 1;
  const price     = parseFloat(rawPrice) / divisor || null;
  const origPrice = parseFloat(rawOrig)  / divisor || null;
  return {
    name:          p.name              || "",
    price,
    originalPrice: origPrice !== price ? origPrice : null,
    discount:      p.on_sale
      ? (origPrice && price ? `-${Math.round((1 - price / origPrice) * 100)}%` : "On Sale")
      : null,
    unit:          p.weight            || null,
    imageUrl:      p.images?.[0]?.src  || "",
    productUrl:    p.permalink         || `${BASE_URL}/?p=${p.id}`,
    sku:           p.sku               || null,
    inStock:       p.is_in_stock       ?? true,
    categories:    (p.categories || []).map((c) => c.name).join(", ") || null,
    rating:        p.average_rating    || null,
    reviewCount:   p.review_count      || null,
  };
}

// ─── DOM Extractor ─────────────────────────────────────────────────────────────

function extractWooProducts() {
  const cleanPrice = (raw) => {
    const n = parseFloat((raw || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };
  const selectors = [
    "ul.products li.product", ".woocommerce-loop-product",
    ".product-grid-item", "[class*='product-item']", ".product",
  ];
  let cards = [];
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 2) { cards = found; break; }
  }
  return Array.from(cards).map((card) => {
    const nameEl   = card.querySelector(".woocommerce-loop-product__title, .product-title, h2, h3, h4");
    const priceIns = card.querySelector("ins .woocommerce-Price-amount");
    const priceDef = card.querySelector(".price > .woocommerce-Price-amount, .woocommerce-Price-amount");
    const origEl   = card.querySelector("del .woocommerce-Price-amount");
    const imgEl    = card.querySelector("img");
    const linkEl   = card.querySelector("a.woocommerce-loop-product__link, a");
    const badgeEl  = card.querySelector(".onsale, .badge, [class*='discount']");
    const unitEl   = card.querySelector("[class*='unit'], [class*='weight'], .unit");
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

// ─── Browse ────────────────────────────────────────────────────────────────────

async function scrapeMeena(shopUrl = `${BASE_URL}/shop`, pages = 1) {
  const page    = await newPage();
  const results = [];
  try {
    await injectSafeFetch(page);
    await navigateTo(page, shopUrl);

    const first = await safeFetchInline(
      page, `${BASE_URL}/wp-json/wc/store/v1/products?per_page=30&page=1`
    );
    if (Array.isArray(first) && first.length > 0) {
      results.push(...first.map(normalizeWooProduct));
      for (let p = 2; p <= pages; p++) {
        const more = await safeFetchInline(
          page, `${BASE_URL}/wp-json/wc/store/v1/products?per_page=30&page=${p}`
        );
        if (!Array.isArray(more) || more.length === 0) break;
        results.push(...more.map(normalizeWooProduct));
        await sleep(DELAY);
      }
    } else {
      for (let p = 1; p <= pages; p++) {
        const url = p === 1 ? shopUrl : `${shopUrl}/page/${p}/`;
        if (p > 1) await navigateTo(page, url);
        await autoScroll(page);
        const dom = await page.evaluate(extractWooProducts);
        if (dom.length === 0) break;
        results.push(...dom);
        await sleep(DELAY);
      }
    }
  } finally {
    await page.close();
  }
  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Grocery" }));
}

// ─── Search ────────────────────────────────────────────────────────────────────

async function searchMeena(keyword, pages = 1) {
  const page    = await newPage();
  const results = [];
  try {
    await injectSafeFetch(page);
    await navigateTo(page, `${BASE_URL}/?s=${encodeURIComponent(keyword)}&post_type=product`);

    const apiBase = `${BASE_URL}/wp-json/wc/store/v1/products?search=${encodeURIComponent(keyword)}&per_page=30`;
    const first   = await safeFetchInline(page, `${apiBase}&page=1`);

    if (Array.isArray(first) && first.length > 0) {
      results.push(...first.map(normalizeWooProduct));
      for (let p = 2; p <= pages; p++) {
        const more = await safeFetchInline(page, `${apiBase}&page=${p}`);
        if (!Array.isArray(more) || more.length === 0) break;
        results.push(...more.map(normalizeWooProduct));
        await sleep(DELAY);
      }
    } else {
      await autoScroll(page);
      const dom = await page.evaluate(extractWooProducts);
      results.push(...dom);
      for (let p = 2; p <= pages; p++) {
        await navigateTo(
          page,
          `${BASE_URL}/page/${p}/?s=${encodeURIComponent(keyword)}&post_type=product`
        );
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

// ─── Categories ───────────────────────────────────────────────────────────────

async function getMeenaCategories() {
  const page = await newPage();
  try {
    await injectSafeFetch(page);
    await navigateTo(page, `${BASE_URL}/shop`);
    const cats = await safeFetchInline(
      page,
      `${BASE_URL}/wp-json/wc/store/v1/products/categories?per_page=50`
    );
    if (Array.isArray(cats) && cats.length > 0) {
      return cats.map((c) => ({
        id: c.id, name: c.name, slug: c.slug, count: c.count,
        url: `${BASE_URL}/product-category/${c.slug}`,
      }));
    }
    return page.evaluate(() => {
      const links = document.querySelectorAll(
        ".product-categories a, .widget_product_categories a, .shop-categories a"
      );
      return Array.from(links)
        .map((a) => ({ name: a.textContent.trim(), url: a.href }))
        .filter((c) => c.name && c.url.includes("meenabazaronline.com"));
    });
  } finally {
    await page.close();
  }
}

module.exports = { scrapeMeena, getMeenaCategories, searchMeena };
