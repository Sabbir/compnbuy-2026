/**
 * detailScraper.js
 * Scrapes a full product detail page (PDP) on Daraz.
 */

const { newPage } = require("../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../browser/pageHelpers");

const DELAY = parseInt(process.env.PAGE_DELAY) || 2000;

// ─── DOM Extractor (runs inside Chromium) ─────────────────────────────────────

function extractDetail(productUrl) {
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() || null;

  const cleanPrice = (raw) => {
    if (!raw) return null;
    const n = parseFloat(raw.replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  const title =
    text("h1.pdp-mod-product-badge-title") ||
    text(".pdp-product-title") ||
    text("h1");

  const price         = cleanPrice(text(".pdp-price_type_normal") || text(".pdp-price"));
  const originalPrice = cleanPrice(text(".pdp-price_type_deleted"));
  const discount      = text(".pdp-product-price__discount");
  const brand         = text(".pdp-link_size_s") || null;
  const rating        = text(".score-average") || text("[class*='average']");
  const reviewRaw     = text(".count-reviews") || "";
  const reviewMatch   = reviewRaw.match(/\d+/);

  const description =
    document.querySelector(".pdp-product-desc, .html-content")
      ?.innerText?.replace(/\s+/g, " ")
      ?.trim() || null;

  // Images — collect unique full URLs
  const images = [];
  document
    .querySelectorAll(
      ".item-gallery__thumbnail img, .pdp-mod-common-image img, .gallery-preview-panel__image img"
    )
    .forEach((img) => {
      const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
      const full = src.startsWith("//") ? "https:" + src : src;
      if (full && !images.includes(full)) images.push(full);
    });

  // Specifications
  const specs = {};
  document.querySelectorAll(".pdp-mod-specification tr").forEach((row) => {
    const cells = row.querySelectorAll("td, th");
    if (cells.length >= 2) {
      const k = cells[0].textContent.trim();
      const v = cells[1].textContent.trim();
      if (k && v) specs[k] = v;
    }
  });
  document.querySelectorAll(".specification-key").forEach((el) => {
    const k = el.textContent.trim();
    const v = el.nextElementSibling?.textContent?.trim() || "";
    if (k && v) specs[k] = v;
  });

  return {
    url: productUrl,
    title,
    price,
    originalPrice,
    discount,
    brand,
    rating,
    reviewCount:    reviewMatch ? parseInt(reviewMatch[0]) : null,
    description,
    specifications: Object.keys(specs).length ? specs : null,
    images,
    scrapedAt:      new Date().toISOString(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape one or more product detail pages.
 * @param {string[]} urls
 * @returns {Promise<object[]>}
 */
async function scrapeDetails(urls) {
  const page = await newPage();
  const results = [];

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim();
      await navigateTo(page, url);
      await autoScroll(page);
      const detail = await page.evaluate(extractDetail, url);
      results.push(detail);
      if (i < urls.length - 1) await sleep(DELAY);
    }
  } finally {
    await page.close();
  }

  return results;
}

module.exports = { scrapeDetails };
