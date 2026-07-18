/**
 * fabrilifeScraper.js
 *
 * CONFIRMED FROM SOURCE (fabrilife.com/shop?query=Jeans, July 2026):
 *
 * Fabrilife uses Algolia InstantSearch for their shop/search page.
 * We call the Algolia Search API directly — no Puppeteer needed.
 *
 * ALGOLIA CONFIG (extracted from their page JS):
 *   App ID:    2UIXGXYA5O
 *   API Key:   bfcfa7b10e2c9220df5d1d639d485218  (public search-only key)
 *   Index:     products
 *   Endpoint:  POST https://2UIXGXYA5O-dsn.algolia.net/1/indexes/products/query
 *
 * SEARCH URL (for productUrl):
 *   https://fabrilife.com/product/<id>-<slug>
 *   Image:  https://fabrilife.com/products/<hash>-square.jpg
 *
 * FALLBACK:
 *   If Algolia is unreachable, falls back to Puppeteer scraping /shop?query=<kw>
 *   and reads the mega-menu product cards which ARE server-rendered in the HTML.
 */

const { newPage }           = require("../../browser/browserManager");
const { navigateTo, sleep } = require("../../browser/pageHelpers");

const BASE_URL       = "https://fabrilife.com";
const ALGOLIA_APP_ID = "2UIXGXYA5O";
const ALGOLIA_KEY    = "bfcfa7b10e2c9220df5d1d639d485218";
const ALGOLIA_INDEX  = "products";
const ALGOLIA_URL    = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;
const SOURCE_NAME    = "fabrilife";
const HITS_PER_PAGE  = 40;
const API_TIMEOUT    = 12000;

// ─── Normalizer ───────────────────────────────────────────────────────────────
function normalizeHit(hit) {
  const clean = (v) => {
    const n = parseFloat(String(v || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  // Algolia hit image field — Fabrilife image is a relative path like:
  //   "/products/651830ea2d2c2-square.png"
  // We try every possible field name, then build the full URL.
  const imgRaw =
    hit.image        ||
    hit.thumbnail    ||
    hit.photo        ||
    hit.picture      ||
    hit.cover        ||
    hit.imageUrl     ||
    hit.image_url    ||
    hit.img          ||
    hit.src          ||
    "";

  let imageUrl = typeof imgRaw === "string"
    ? imgRaw
    : (imgRaw?.url || imgRaw?.src || imgRaw?.path || "");

  // Resolve to full URL — Algolia returns image in one of these shapes:
  //   "660ab04660919-square.jpg"          ← just filename (most common)
  //   "/products/660ab04660919-square.jpg" ← relative with /products/
  //   "https://fabrilife.com/products/..." ← already full
  if (imageUrl && !imageUrl.startsWith("http")) {
    if (imageUrl.startsWith("/products/") || imageUrl.startsWith("products/")) {
      // Already has /products/ path — just prepend domain
      imageUrl = BASE_URL + (imageUrl.startsWith("/") ? "" : "/") + imageUrl;
    } else {
      // Just a filename — add /products/ in the middle
      imageUrl = `${BASE_URL}/products/${imageUrl}`;
    }
  }

  // Product URL: Fabrilife format is /product/<id>-<slug>
  // e.g. https://fabrilife.com/product/73494-kids-premium-t-shirt-elephant
  const slug = hit.slug || hit.handle || "";
  const id   = hit.objectID || hit.id || "";
  let productUrl = "";
  if (id && slug) {
    // Guard: if slug already starts with the id, don't double-prefix
    productUrl = slug.startsWith(`${id}-`)
      ? `${BASE_URL}/product/${slug}`
      : `${BASE_URL}/product/${id}-${slug}`;
  } else if (slug) {
    // slug might already include the id prefix (e.g. "73494-kids-premium-...")
    productUrl = `${BASE_URL}/product/${slug}`;
  } else if (id) {
    productUrl = `${BASE_URL}/product/${id}`;
  }

  const price     = clean(hit.price         || hit.sale_price);
  const origPrice = clean(hit.compare_price || hit.regular_price || hit.mrp || hit.original_price);

  let discount = null;
  if (origPrice && price && origPrice > price) {
    const pct = Math.round((1 - price / origPrice) * 100);
    if (pct > 0) discount = `-${pct}%`;
  }

  return {
    name:          (hit.title || hit.name || "").replace(/Fabrilife/gi, "").trim(),
    price,
    originalPrice: origPrice && origPrice !== price ? origPrice : null,
    discount,
    unit:          null,
    imageUrl,
    productUrl,
    inStock:       hit.status === 1 || hit.in_stock !== false,
    source:        SOURCE_NAME,
    category:      "Clothing",
  };
}

// ─── Strategy 1: Algolia API (no browser) ─────────────────────────────────────
async function fetchViaAlgolia(keyword, page = 0) {
  const { default: fetch } = await import("node-fetch");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const res = await fetch(ALGOLIA_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "X-Algolia-Application-Id": ALGOLIA_APP_ID,
        "X-Algolia-API-Key":        ALGOLIA_KEY,
        "Content-Type":             "application/json",
      },
      body: JSON.stringify({
        query:       keyword,
        hitsPerPage: HITS_PER_PAGE,
        page,
      }),
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[fabrilife] Algolia API ${res.status} for "${keyword}"`);
      return null;
    }

    const json = await res.json().catch(() => null);
    if (!json?.hits) {
      console.warn(`[fabrilife] Unexpected Algolia response for "${keyword}"`);
      return null;
    }

    console.log(`[fabrilife] Algolia: ${json.nbHits} total hits for "${keyword}", got ${json.hits.length}`);

    // Always log first hit's image-related fields on first call to confirm field name
    if (json.hits.length > 0) {
      const h = json.hits[0];
      const imgFields = Object.entries(h)
        .filter(([k, v]) => typeof v === "string" && (
          v.includes("/products/") || v.includes("square") ||
          v.includes(".jpg") || v.includes(".png") || v.includes(".webp")
        ))
        .map(([k, v]) => `${k}="${v.substring(0, 80)}"`);
      console.log(`[fabrilife] Image fields on first hit: ${imgFields.join(" | ") || "NONE — keys: " + Object.keys(h).join(", ")}`);
    }

    return json.hits;
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[fabrilife] Algolia error for "${keyword}":`,
      err.name === "AbortError" ? "timeout" : err.message);
    return null;
  }
}

// ─── Strategy 2: Puppeteer fallback ──────────────────────────────────────────
// Fabrilife server-renders the mega-menu product cards (New Arrivals) in the HTML.
// For the search fallback we scrape those — they have name + image, but no price.
async function fetchViaBrowser(keyword) {
  const page = await newPage();
  try {
    const url = `${BASE_URL}/shop?query=${encodeURIComponent(keyword)}`;
    await navigateTo(page, url);
    await sleep(3000); // wait for Algolia's InstantSearch to render hits

    return page.evaluate((baseUrl) => {
      // Try Algolia InstantSearch rendered hits first
      const hitSelectors = [
        ".ais-Hits-item",
        ".ais-InfiniteHits-item",
        "[class*='hit']",
        ".product-card",
        ".shop-item",
      ];

      let cards = [];
      for (const sel of hitSelectors) {
        cards = Array.from(document.querySelectorAll(sel));
        if (cards.length > 1) break;
      }

      // Fallback: mega-menu product cards (always server-rendered)
      if (cards.length === 0) {
        cards = Array.from(document.querySelectorAll(".mega-menu-product-card"));
      }

      return cards.map((card) => {
        const linkEl  = card.querySelector("a[href]") || (card.tagName === "A" ? card : null);
        const imgEl   = card.querySelector("img");
        const nameEl  = card.querySelector("[class*='title'], [class*='name'], h2, h3, h4");
        const priceEl = card.querySelector("[class*='price']");

        const href = linkEl?.getAttribute("href") || card.getAttribute("href") || "";
        let imgSrc = imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || "";
        if (imgSrc && !imgSrc.startsWith("http")) {
          imgSrc = baseUrl + (imgSrc.startsWith("/") ? "" : "/") + imgSrc;
        }

        return {
          name:       nameEl?.textContent?.trim() || card.getAttribute("alt") || "",
          price:      parseFloat((priceEl?.textContent || "").replace(/[^\d.]/g, "")) || null,
          imageUrl:   imgSrc,
          productUrl: href.startsWith("http") ? href : baseUrl + href,
        };
      }).filter(p => p.name);
    }, BASE_URL);
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
async function searchFabrilife(keyword, _pages = 1) {
  if (!keyword?.trim()) throw new Error("keyword is required");

  const q = keyword.trim();
  console.log(`[fabrilife] Searching: "${q}"`);

  // Try Algolia first — fast, no browser
  let hits = await fetchViaAlgolia(q);

  if (!hits) {
    console.log(`[fabrilife] Falling back to browser for "${q}"`);
    try {
      hits = await fetchViaBrowser(q);
    } catch (err) {
      console.error(`[fabrilife] Browser fallback failed:`, err.message);
    }
  }

  if (!hits?.length) {
    console.warn(`[fabrilife] No products found for "${q}"`);
    return [];
  }

  const results = hits
    .map(normalizeHit)
    .filter((p) => p.name && p.price !== null);

  console.log(`[fabrilife] ${results.length} products normalised for "${q}"`);
  return results;
}

async function scrapeFabrilife(listingUrl = `${BASE_URL}/shop`, _pages = 1) {
  // For category browse, extract keyword from URL and search
  const params = new URLSearchParams(listingUrl.split("?")[1] || "");
  const keyword = params.get("query") || listingUrl.split("/").pop().replace(/-/g, " ") || "clothing";
  return searchFabrilife(keyword);
}

async function getFabrilifeCategories() {
  return [
    { name: "Men",      url: `${BASE_URL}/shop?query=men` },
    { name: "Women",    url: `${BASE_URL}/shop?query=women` },
    { name: "Kids",     url: `${BASE_URL}/shop?query=kids` },
    { name: "Panjabi",  url: `${BASE_URL}/shop?query=panjabi` },
    { name: "T-Shirt",  url: `${BASE_URL}/shop?query=t-shirt` },
    { name: "Polo",     url: `${BASE_URL}/shop?query=polo` },
    { name: "Jeans",    url: `${BASE_URL}/shop?query=jeans` },
    { name: "Salwar",   url: `${BASE_URL}/shop?query=salwar` },
  ];
}

module.exports = { scrapeFabrilife, getFabrilifeCategories, searchFabrilife };
