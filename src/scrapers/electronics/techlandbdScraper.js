/**
 * techlandbdScraper.js
 * Scrapes product data from techlandbd.com
 *
 * Platform: Laravel + Livewire (server-side rendered HTML)
 * Confirmed from live HTML analysis (May 2026)
 *
 * Search URL : https://www.techlandbd.com/search/advance/product/result/<keyword>
 * Pagination : ?page=N  (30 per page, up to ~34 pages for broad queries)
 *
 * DOM selectors (all confirmed from live page):
 *  Card wrapper   : div.h-full > div.bg-white.rounded-lg.shadow-sm
 *  Save badge     : span.absolute.top-4.left-4  → "Save : ৳ 100"
 *  Product link   : div.p-2\.5 > a[href]  OR  img parent a[href]
 *  Product image  : img.w-full.h-48.object-contain
 *  Product name   : div.p-4.flex-grow a.text-gray-800.font-semibold.text-sm
 *  Stock status   : span.font-bold (text-green-600 = In Stock, text-red-600 = Out of Stock)
 *  Current price  : span.text-lg.font-bold.text-red-600   → "৳ 750"
 *  Original price : span.text-sm.text-gray-500.line-through  → "850"  (no ৳ symbol)
 *  Checkout disc. : div.discount-text  (optional green animated banner)
 *  Total results  : div containing "Showing 30 out of 1000 products"
 */

const { newPage }                       = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");

const BASE_URL    = "https://www.techlandbd.com";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2500;
const SOURCE_NAME = "techlandbd";

// ─── DOM extractor (runs inside page context) ─────────────────────────────────

function extractTechlandProducts() {
  const cleanPrice = (raw) => {
    if (!raw) return null;
    // Remove ৳, commas, whitespace then parse
    const n = parseFloat(raw.replace(/[৳,\s]/g, "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  // All product cards — each card is div.h-full containing div.bg-white.rounded-lg
  const cards = document.querySelectorAll(
    ".grid.grid-cols-1 > div.h-full"
  );

  return Array.from(cards).map((card) => {
    const inner = card.querySelector("div.bg-white.rounded-lg");
    if (!inner) return null;

    // ── Product link & image ──────────────────────────────────────────────
    const linkEl     = inner.querySelector("a[href]");
    const imgEl      = inner.querySelector("img.object-contain");
    const productUrl = linkEl?.href || "";
    const imageUrl   = imgEl?.src   || "";

    // ── Product name ──────────────────────────────────────────────────────
    const nameEl = inner.querySelector("div.flex-grow a.font-semibold");
    const name   = nameEl?.textContent?.trim() || "";
    if (!name) return null;

    // ── Stock status ──────────────────────────────────────────────────────
    const stockEl  = inner.querySelector("span.font-bold");
    const stockTxt = stockEl?.textContent?.trim() || "";
    const inStock  = stockEl?.classList.contains("text-green-600") ?? false;

    // ── Prices ────────────────────────────────────────────────────────────
    const priceEl    = inner.querySelector("span.text-lg.font-bold.text-red-600");
    const origEl     = inner.querySelector("span.text-sm.text-gray-500.line-through");
    const price      = cleanPrice(priceEl?.textContent);
    const origPrice  = cleanPrice(origEl?.textContent);

    // ── Save badge ────────────────────────────────────────────────────────
    // "Save : ৳ 100"
    const saveBadge  = inner.querySelector("span.absolute.top-4.left-4");
    const saveText   = saveBadge?.textContent?.trim() || null;

    // ── Checkout discount banner (optional animated green tag) ────────────
    const discEl     = inner.querySelector("div.discount-text");
    const discountNote = discEl?.textContent?.trim() || null;

    return {
      name,
      price,
      originalPrice: (origPrice && origPrice > price) ? origPrice : null,
      saveBadge:     saveText,
      discount:      discountNote,
      inStock,
      imageUrl,
      productUrl,
    };
  }).filter(Boolean);
}

// ─── Extract total product count from page ────────────────────────────────────

function extractTotalCount() {
  // "Showing 30 out of 1000 products"
  const divs = document.querySelectorAll("div");
  for (const div of divs) {
    const txt = div.textContent;
    const m   = txt.match(/Showing\s+\d+\s+out\s+of\s+([\d,]+)\s+products/i);
    if (m) return parseInt(m[1].replace(/,/g, ""));
  }
  return null;
}

// ─── Core scraper ─────────────────────────────────────────────────────────────

async function scrapeTechlandbdUrl(url, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    for (let p = 1; p <= pages; p++) {
      const pageUrl = p === 1 ? url : `${url}?page=${p}`;

      await navigateTo(page, pageUrl);
      await autoScroll(page);
      await sleep(800);

      const products = await page.evaluate(extractTechlandProducts);
      if (!products || products.length === 0) break;

      results.push(...products);

      // Auto-cap pages based on real total on first page
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
 * Search TechLand BD by keyword.
 * URL: https://www.techlandbd.com/search/advance/product/result/<keyword>
 */
async function searchTechlandbd(keyword, pages = 1) {
  const url = `${BASE_URL}/search/advance/product/result/${encodeURIComponent(keyword)}`;
  return scrapeTechlandbdUrl(url, pages);
}

/**
 * Browse a TechLand BD category URL directly.
 * @param {string} categoryUrl  Full URL or path slug
 */
async function scrapeTechlandbd(categoryUrl, pages = 1) {
  const url = categoryUrl.startsWith("http")
    ? categoryUrl
    : `${BASE_URL}/${categoryUrl}`;
  return scrapeTechlandbdUrl(url, pages);
}

/**
 * Get categories from TechLand BD nav menu.
 */
async function getTechlandbdCategories() {
  const page = await newPage();
  try {
    await navigateTo(page, BASE_URL);
    await sleep(1500); // wait for async nav injection
    return page.evaluate(() => {
      const links = document.querySelectorAll(
        "#header-navigation-container a, nav.nav-menu a"
      );
      return Array.from(links)
        .map((a) => ({ name: a.textContent.trim(), url: a.href }))
        .filter(
          (c) =>
            c.name.length > 1 &&
            c.url.includes("techlandbd.com") &&
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

module.exports = { scrapeTechlandbd, searchTechlandbd, getTechlandbdCategories };
