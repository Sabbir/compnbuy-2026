/**
 * ryansScraper.js
 * Scrapes product data from ryans.com
 *
 * Platform: Custom PHP / Laravel (Bootstrap 5 frontend)
 * Confirmed from live HTML analysis (May 2026)
 *
 * Search URL:  https://www.ryans.com/search?search=<keyword>
 * Pagination:  ?search=<kw>&limit=30&page=N
 * Category:    https://www.ryans.com/category/<slug>?page=N
 *
 * DOM selectors (all confirmed from live page):
 *  Card wrapper  : div.cus-col-1.category-single-product > div.card.h-100
 *  Product link  : div.image-box > a[href]
 *  Product image : div.image-box > a > img.card-img-top
 *  Full name     : h4.product-title > a[title]  (title attr = full un-truncated name)
 *  SKU / ID      : span.found-text
 *  Current price : p.pr-text.cat-sp-text         (card body)
 *  Regular price : div.modal span.new-reg-text    (inline modal on same page)
 *  Special price : div.modal span.new-sp-text     (inline modal on same page)
 *  Discount note : span.fs-text
 */

const { newPage }                       = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");

const BASE_URL    = "https://www.ryans.com";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2500;
const SOURCE_NAME = "ryans";

// ─── DOM extractor (runs inside page context) ─────────────────────────────────

function extractRyansProducts() {
  const cleanPrice = (raw) => {
    if (!raw) return null;
    const n = parseFloat(raw.replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  const cards = document.querySelectorAll(
    "div.cus-col-1.category-single-product"
  );

  return Array.from(cards).map((card) => {
    // ── Link & image ──────────────────────────────────────────────────────
    const imgBox     = card.querySelector("div.image-box");
    const linkEl     = imgBox?.querySelector("a");
    const imgEl      = imgBox?.querySelector("img.card-img-top");
    const productUrl = linkEl?.href || "";
    const imageUrl   = imgEl?.src   || "";

    // ── Full name via title attribute (no truncation) ─────────────────────
    const nameEl = card.querySelector("h4.product-title a");
    const name   = nameEl?.getAttribute("title")
                || nameEl?.textContent?.replace(/\.\.\.\s*$/, "").trim()
                || "";
    if (!name) return null;

    // ── SKU ───────────────────────────────────────────────────────────────
    const sku = card.querySelector("span.found-text")?.textContent?.trim() || "";

    // ── Current price from card body ──────────────────────────────────────
    const cardPrice = cleanPrice(
      card.querySelector("p.pr-text.cat-sp-text")?.textContent
    );

    // ── Both prices from inline modal markup ──────────────────────────────
    const modal      = card.querySelector("div.modal.product_view");
    const spPrice    = cleanPrice(modal?.querySelector("span.new-sp-text")?.textContent);
    const regPrice   = cleanPrice(modal?.querySelector("span.new-reg-text")?.textContent);

    const currentPrice = spPrice || cardPrice;
    const origPrice    = regPrice && regPrice > currentPrice ? regPrice : null;

    // ── Discount note ─────────────────────────────────────────────────────
    const discEl       = card.querySelector("span.fs-text");
    const discountNote = discEl?.getAttribute("title")
                      || discEl?.textContent?.trim()
                      || null;

    return {
      name,
      price:         currentPrice,
      originalPrice: origPrice,
      discount:      discountNote,
      sku,
      imageUrl,
      productUrl,
    };
  }).filter(Boolean);
}

// ─── Get total result count ────────────────────────────────────────────────────

function extractTotalCount() {
  // <b>1482&nbsp;products found</b>
  const bEl = document.querySelector(".category-pagination-section b");
  if (bEl) {
    const n = parseInt(bEl.textContent.replace(/[^\d]/g, ""));
    if (!isNaN(n)) return n;
  }
  return null;
}

// ─── Core scraper ─────────────────────────────────────────────────────────────

async function scrapeRyansUrl(url, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    for (let p = 1; p <= pages; p++) {
      const sep     = url.includes("?") ? "&" : "?";
      const pageUrl = p === 1 ? url : `${url}${sep}limit=30&page=${p}`;

      await navigateTo(page, pageUrl);
      await autoScroll(page);
      await sleep(800);

      const products = await page.evaluate(extractRyansProducts);
      if (!products || products.length === 0) break;

      results.push(...products);

      // Auto-cap pages based on real total
      if (p === 1 && pages > 1) {
        const total = await page.evaluate(extractTotalCount);
        if (total !== null) {
          const maxPages = Math.ceil(total / 30);
          if (pages > maxPages) pages = maxPages;
        }
      }

      if (p < pages) await sleep(DELAY);
    }
  } finally {
    await page.close();
  }

  return results.map((item) => ({
    ...item,
    source:   SOURCE_NAME,
    category: "Electronics",
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search Ryans by keyword.
 * URL: https://www.ryans.com/search?search=<keyword>
 * Pagination: &limit=30&page=N
 */
async function searchRyans(keyword, pages = 1) {
  const searchUrl = `${BASE_URL}/search?search=${encodeURIComponent(keyword)}`;
  return scrapeRyansUrl(searchUrl, pages);
}

/**
 * Browse a Ryans category page.
 * @param {string} categorySlug  e.g. "desktop-component-mouse"
 */
async function scrapeRyans(categorySlug = "desktop-component-mouse", pages = 1) {
  const url = categorySlug.startsWith("http")
    ? categorySlug
    : `${BASE_URL}/category/${categorySlug}`;
  return scrapeRyansUrl(url, pages);
}

/**
 * Get Ryans product categories from nav menu.
 */
async function getRyansCategories() {
  const page = await newPage();
  try {
    await navigateTo(page, BASE_URL);
    await sleep(1000);
    return page.evaluate(() => {
      const links = document.querySelectorAll("#navbar_main a, nav.main-menu a");
      return Array.from(links)
        .map((a) => ({ name: a.textContent.trim(), url: a.href }))
        .filter(
          (c) =>
            c.name.length > 1 &&
            c.url.includes("ryans.com/category") &&
            !c.url.includes("#")
        )
        .reduce((acc, c) => {
          if (!acc.find((x) => x.url === c.url)) acc.push(c);
          return acc;
        }, []);
    });
  } finally {
    await page.close();
  }
}

module.exports = { scrapeRyans, searchRyans, getRyansCategories };
