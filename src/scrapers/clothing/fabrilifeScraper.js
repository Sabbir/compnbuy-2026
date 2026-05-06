/**
 * fabrilifeScraper.js
 * Scrapes product data from fabrilife.com
 *
 * Platform: Custom Laravel / PHP e-commerce (Bangladeshi fashion brand)
 * Strategy:
 *  1. Try /api/products or /products.json endpoint (some Laravel shops expose these)
 *  2. Intercept XHR responses for product data
 *  3. Fallback: parse rendered HTML product grid
 *
 * Known URL patterns:
 *   /products           → all products listing
 *   /products?page=N    → paginated listing
 *   /category/<slug>    → category listing
 */

const { newPage } = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");

const BASE_URL    = "https://fabrilife.com";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "fabrilife";

// ─── XHR Interception ────────────────────────────────────────────────────────

async function interceptAndLoad(page, url) {
  const captured = [];

  page.on("response", async (res) => {
    const resUrl = res.url();
    const ct     = res.headers()["content-type"] || "";
    if (
      ct.includes("json") &&
      (resUrl.includes("product") || resUrl.includes("catalog") || resUrl.includes("item"))
    ) {
      try {
        const _t = await res.text().catch(() => ""); const _f = _t.trimStart()[0]; if (_f !== "{" && _f !== "[") return; let json; try { json = JSON.parse(_t); } catch { return; }
        const items =
          json.data?.data || json.data || json.products ||
          json.items      || json.results ||
          (Array.isArray(json) ? json : []);
        if (items.length) captured.push(...items);
      } catch { /* skip */ }
    }
  });

  await navigateTo(page, url);
  await autoScroll(page);
  await sleep(1500);
  return captured;
}

// ─── API probe ────────────────────────────────────────────────────────────────

async function tryApiEndpoints(page) {
  const candidates = [
    `${BASE_URL}/api/products?per_page=50&page=1`,
    `${BASE_URL}/products.json?limit=50`,
    `${BASE_URL}/api/v1/products`,
    `${BASE_URL}/api/catalog/products`,
  ];

  for (const url of candidates) {
    try {
      const data = await page.evaluate(async (apiUrl) => {
        const r = await fetch(apiUrl, { headers: { Accept: "application/json" } });
        if (!r.ok) return null;
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("json")) return null;
      const text = await r.text();
      const first = text.trimStart()[0];
      if (first !== "{" && first !== "[") return null;
      try { return JSON.parse(text); } catch { return null; }
      }, url);

      if (!data) continue;
      const items =
        data.data?.data || data.data || data.products ||
        data.items      || (Array.isArray(data) ? data : null);
      if (Array.isArray(items) && items.length > 0) return items;
    } catch { /* skip */ }
  }
  return null;
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

function normalizeApiProduct(p) {
  const cleanPrice = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  return {
    name:          p.name          || p.title       || p.product_name || "",
    price:         cleanPrice(p.price          || p.sale_price    || p.current_price),
    originalPrice: cleanPrice(p.regular_price  || p.mrp           || p.original_price),
    discount:      p.discount      || p.discount_text || null,
    sku:           p.sku           || p.code         || null,
    imageUrl:      p.image         || p.thumbnail    || p.image_url   || p.featured_image || "",
    productUrl:    p.url           || (p.slug ? `${BASE_URL}/products/${p.slug}` : ""),
    inStock:       p.in_stock      ?? p.available    ?? true,
    sizes:         Array.isArray(p.sizes)  ? p.sizes  : null,
    colors:        Array.isArray(p.colors) ? p.colors : null,
    productType:   p.category      || p.type         || null,
  };
}

// ─── DOM Extractor ────────────────────────────────────────────────────────────

function extractFromDom() {
  const cleanPrice = (raw) => {
    const n = parseFloat((raw || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  const selectors = [
    '.product-card',
    '.product-name',
    '[Class: "product-card"]',
    '.product-price-row'
  ];

  let cards = [];
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 2) { cards = found; break; }
  }

  return Array.from(cards).map((card) => {
    const nameEl  = card.querySelector(
      "[class*='name'], [class*='title'], h2, h3, h4, [class*='product-name']"
    );
    const priceEl = card.querySelector(
      '.card-text, [class*="price-current"]'
    );
    const origEl  = card.querySelector(
      "[class*='price-original'], [class*='was'], del, s, strike"
    );
    const discEl  = card.querySelector("[class*='price-off'], [class*='badge']");
    const imgEl   = card.querySelector("img");
    const linkEl  = card.querySelector("a");
    const unitEl  = card.querySelector("[class*='size'], [class*='unit']");

    const name = nameEl?.textContent?.trim() || "";
    if (!name) return null;

    return {
      name,
      price:         cleanPrice(priceEl?.textContent),
      originalPrice: cleanPrice(origEl?.textContent),
      discount:      discEl?.textContent?.trim()  || null,
      imageUrl:      imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazySrc || "",
      productUrl:    linkEl?.href || "",
      unit:          unitEl?.textContent?.trim()  || null,
    };
  }).filter(Boolean);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape Fabrilife products.
 * @param {string} listingUrl  e.g. "https://fabrilife.com/products"
 * @param {number} pages
 */
async function scrapeFabrilife(listingUrl = `${BASE_URL}/products`, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    // Navigate first to set session cookies
    await navigateTo(page, listingUrl);

    // 1. Try REST API endpoints
    const apiData = await tryApiEndpoints(page);
    if (apiData && apiData.length > 0) {
      results.push(...apiData.map(normalizeApiProduct));
    } else {
      // 2. XHR interception + DOM per page
      for (let p = 1; p <= pages; p++) {
        const url = p === 1
          ? listingUrl
          : `${listingUrl}?page=${p}`;

        let intercepted = [];
        if (p > 1) {
          intercepted = await interceptAndLoad(page, url);
        } else {
          intercepted = []; // already navigated, just scrape DOM
        }

        if (intercepted.length > 0) {
          results.push(...intercepted.map(normalizeApiProduct));
        } else {
          if (p > 1) await navigateTo(page, url);
          await autoScroll(page);
          const dom = await page.evaluate(extractFromDom);
          if (dom.length === 0) break;
          results.push(...dom);
        }

        if (p < pages) await sleep(DELAY);
      }
    }
  } finally {
    page.removeAllListeners("response");
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Clothing" }));
}

/**
 * Get Fabrilife categories from nav/menu.
 */
async function getFabrilifeCategories() {
  const page = await newPage();
  try {
    await navigateTo(page, BASE_URL);
    return page.evaluate(() => {
      const links = document.querySelectorAll(
        "nav a, .navbar a, [class*='category'] a, [class*='menu'] a"
      );
      return Array.from(links)
        .map((a) => ({ name: a.textContent.trim(), url: a.href }))
        .filter((c) => c.name && c.url.includes("fabrilife.com") && c.name.length > 1);
    });
  } finally {
    await page.close();
  }
}


/**
 * Search Fabrilife products by keyword.
 * Tries known API endpoints first, then falls back to the search URL.
 * @param {string} keyword
 * @param {number} pages
 */
async function searchFabrilife(keyword, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    const searchUrl = `${BASE_URL}/shop?query=${encodeURIComponent(keyword)}`;
    await navigateTo(page, searchUrl);

    // Try API search endpoint
    const apiCandidates = [
      `${BASE_URL}/api/products?search=${encodeURIComponent(keyword)}&per_page=30`,
      `${BASE_URL}/api/v1/products?q=${encodeURIComponent(keyword)}`,
      `${BASE_URL}/products?q=${encodeURIComponent(keyword)}&format=json`,
    ];

    let apiHit = false;
    for (const endpoint of apiCandidates) {
      const data = await page.evaluate(async (url) => {
        try {
          const r = await fetch(url, { headers: { Accept: "application/json" } });
          if (!r.ok) return null;
          const ct = r.headers.get("content-type") || "";
          if (!ct.includes("json")) return null;
          const text = await r.text();
          const first = text.trimStart()[0];
          if (first !== "{" && first !== "[") return null;
          return JSON.parse(text);
        } catch { return null; }
      }, endpoint);

      if (data) {
        const items = data.data?.data || data.data || data.products ||
                      data.items || (Array.isArray(data) ? data : null);
        if (Array.isArray(items) && items.length > 0) {
          results.push(...items.map(normalizeApiProduct));
          apiHit = true;
          break;
        }
      }
    }

    // DOM fallback
    if (!apiHit) {
      for (let p = 1; p <= pages; p++) {
        const url = p === 1 ? searchUrl : `${searchUrl}&page=${p}`;
        if (p > 1) await navigateTo(page, url);
        await autoScroll(page);
        const dom = await page.evaluate(extractFromDom);
        if (dom.length === 0) break;

        results.push(...dom);
        if (p < pages) await sleep(DELAY);
      }
    }
  } finally {
    page.removeAllListeners("response");
    await page.close();
  }

  return results.map((p) => ({ ...p, source: SOURCE_NAME, category: "Clothing" }));
}

module.exports = { scrapeFabrilife, getFabrilifeCategories, searchFabrilife };
