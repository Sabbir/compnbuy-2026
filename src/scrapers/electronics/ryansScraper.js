/**
 * ryansScraper.js
 * Scrapes product data from ryans.com
 *
 * Platform: Custom PHP e-commerce (similar OpenCart-based structure to StarTech)
 * Strategy:
 *  1. XHR/API interception for JSON product data
 *  2. DOM parsing: product-layout / product-grid / product-thumb selectors
 *  3. Search via /index.php?route=product/search&search=<keyword>
 *
 * Pagination: ?page=N
 * Category URLs: /laptops, /desktops, /phones, /gaming, /components, etc.
 */

const { newPage }                      = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");

const BASE_URL    = "https://www.ryans.com";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "ryans";

// ─── XHR Interception ─────────────────────────────────────────────────────────

async function interceptProducts(page, url) {
  const captured = [];

  page.on("response", async (res) => {
    const resUrl = res.url();
    const ct     = res.headers()["content-type"] || "";
    if (ct.includes("json") && (
      resUrl.includes("product") || resUrl.includes("catalog") ||
      resUrl.includes("search") || resUrl.includes("category")
    )) {
      try {
        const json  = await res.json();
        const items = json.products || json.data?.products || json.data ||
                      json.items || (Array.isArray(json) ? json : []);
        if (items.length) captured.push(...items);
      } catch { /* not parseable JSON */ }
    }
  });

  await navigateTo(page, url);
  await autoScroll(page);
  await sleep(1200);

  return captured;
}

// ─── DOM Extractor ─────────────────────────────────────────────────────────────

function extractProducts() {
  const cleanPrice = (raw) => {
    if (!raw) return null;
    const n = parseFloat(raw.replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  // Ryans uses product-layout cards — OpenCart default + custom classes
  const selectors = [
    ".product-layout",
    ".product-thumb",
    "[class*='product-grid'] .product-layout",
    ".product-item",
    "[class*='product-card']",
    ".item-product",
    "[data-product-id]",
  ];

  let cards = [];
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 1) { cards = found; break; }
  }

  return Array.from(cards).map((card) => {
    const nameEl   = card.querySelector(
      "h4.name a, h4 a, .product-name a, .name a, [class*='title'] a, h4, h3"
    );
    const name     = nameEl?.getAttribute("title") || nameEl?.textContent?.trim() || "";
    if (!name) return null;

    // Ryans shows prices inside .price / .price-new / strikethrough for old
    const priceNewEl = card.querySelector(".price-new, .price-sale, .special-price");
    const priceEl    = card.querySelector(".price:not(.old-price)");
    const origEl     = card.querySelector(".price-old, .old-price, del, s, .regular-price");
    const badgeEl    = card.querySelector(".sticker, .onsale, .badge, [class*='off']");
    const imgEl      = card.querySelector("img");
    const linkEl     = card.querySelector("a");
    const ratingEl   = card.querySelector(".rating-stars, .stars, [class*='rating']");
    const brandEl    = card.querySelector(".manufacturer, [class*='brand'], [class*='vendor']");

    const price     = cleanPrice((priceNewEl || priceEl)?.textContent);
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
        ? linkEl.href.startsWith("http") ? linkEl.href : "https://www.ryans.com" + linkEl.href
        : "",
    };
  }).filter(Boolean);
}

function normalizeApiProduct(p) {
  const cleanP = (v) => { const n = parseFloat(String(v || "").replace(/[^\d.]/g, "")); return isNaN(n) ? null : n; };
  return {
    name:          p.name || p.title || p.product_name || "",
    price:         cleanP(p.special || p.price || p.sale_price),
    originalPrice: cleanP(p.price   || p.regular_price),
    discount:      p.discount || null,
    brand:         p.manufacturer || p.brand || null,
    rating:        p.rating || null,
    imageUrl:      p.thumb || p.image || "",
    productUrl:    p.href  || (p.product_id ? `${BASE_URL}/product/${p.product_id}` : ""),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape Ryans product listings from a category/listing URL.
 * @param {string} listingUrl   e.g. "https://www.ryans.com/laptops"
 * @param {number} pages
 */
async function scrapeRyans(listingUrl = `${BASE_URL}/laptops`, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    for (let p = 1; p <= pages; p++) {
      const url = p === 1 ? listingUrl : `${listingUrl}?page=${p}`;

      // Use XHR interception on first page, then DOM for subsequent
      if (p === 1) {
        const intercepted = await interceptProducts(page, url);
        if (intercepted.length > 0) {
          results.push(...intercepted.map(normalizeApiProduct));
          page.removeAllListeners("response");

          // Fetch remaining pages via DOM (intercepted data may only cover p1)
          for (let pp = 2; pp <= pages; pp++) {
            await navigateTo(page, `${listingUrl}?page=${pp}`);
            await autoScroll(page);
            const dom = await page.evaluate(extractProducts);
            if (dom.length === 0) break;
            results.push(...dom);
            if (pp < pages) await sleep(DELAY);
          }
          break; // outer loop done
        } else {
          page.removeAllListeners("response");
          await autoScroll(page); // page already loaded by interceptProducts
          const dom = await page.evaluate(extractProducts);
          results.push(...dom);
        }
      } else {
        await navigateTo(page, url);
        await autoScroll(page);
        const dom = await page.evaluate(extractProducts);
        if (dom.length === 0) break;
        results.push(...dom);
      }

      if (p < pages) await sleep(DELAY);
    }
  } finally {
    page.removeAllListeners("response");
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Electronics" }));
}

/**
 * Search Ryans by keyword.
 * @param {string} keyword
 * @param {number} pages
 */
async function searchRyans(keyword, pages = 1) {
  const searchUrl = `${BASE_URL}/index.php?route=product/search&search=${encodeURIComponent(keyword)}`;
  return scrapeRyans(searchUrl, pages);
}

/**
 * Get Ryans top-level navigation categories.
 */
async function getRyansCategories() {
  const page = await newPage();
  try {
    await navigateTo(page, BASE_URL);
    return page.evaluate(() => {
      const links = document.querySelectorAll("#menu a, .nav-menu a, nav a, .main-menu a");
      return Array.from(links)
        .map((a) => ({ name: a.textContent.trim(), url: a.href }))
        .filter((c) => c.name.length > 1 && c.url.includes("ryans.com") && !c.url.includes("#"));
    });
  } finally {
    await page.close();
  }
}

module.exports = { scrapeRyans, searchRyans, getRyansCategories };
