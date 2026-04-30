/**
 * basketScraper.js
 * Scrapes product data from thebasketbd.com
 *
 * Platform : Magento 2  (confirmed via /catalogsearch/result/?q= URL pattern)
 *
 * Search URL : https://www.thebasketbd.com/catalogsearch/result/?q=<keyword>
 * Pagination  : ?q=<keyword>&p=2
 *
 * Magento 2 DOM structure (from official source code):
 *   <ol class="products list items product-items">
 *     <li class="item product product-item">
 *       <div class="product-item-info">
 *         <a class="product-item-photo">  ← product link + image
 *         <div class="product-item-details">
 *           <strong class="product-item-name">
 *             <a class="product-item-link">  ← product name
 *           <div class="price-box">
 *             <span class="price-container">
 *               <span class="price">৳XXX</span>  ← current price
 *             <span class="old-price">
 *               <span class="price">৳YYY</span>  ← original price (if on sale)
 *
 * Magento 2 REST API (tried first — faster + structured):
 *   GET /rest/V1/search?searchCriteria[requestName]=quick_search_container
 *     &searchCriteria[filterGroups][0][filters][0][field]=search_term
 *     &searchCriteria[filterGroups][0][filters][0][value]=<keyword>
 *
 * All fetch() calls use safeFetchInline to guard against HTML error responses.
 */

const { newPage }                      = require("../../browser/browserManager");
const { navigateTo, autoScroll, sleep } = require("../../browser/pageHelpers");
const { injectSafeFetch, safeFetchInline } = require("../../utils/safeFetch");

const BASE_URL    = "https://www.thebasketbd.com";
const DELAY       = parseInt(process.env.PAGE_DELAY) || 2000;
const SOURCE_NAME = "thebasketbd";

// ─── Magento 2 REST API normalizer ────────────────────────────────────────────

function normalizeMagentoProduct(p) {
  const cleanP = (v) => {
    const n = parseFloat(String(v || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  // Magento REST /search returns items with custom_attributes array
  const attrs   = {};
  (p.custom_attributes || []).forEach((a) => { attrs[a.attribute_code] = a.value; });

  const price     = cleanP(p.price);
  const origPrice = cleanP(p.extension_attributes?.regular_price ?? attrs.special_price ?? null);

  // Build product URL from url_key
  const urlKey  = p.custom_attributes?.find?.((a) => a.attribute_code === "url_key")?.value
                  || attrs.url_key || "";
  const productUrl = urlKey
    ? `${BASE_URL}/${urlKey}.html`
    : `${BASE_URL}/catalog/product/view/id/${p.id}`;

  // Image from media_gallery_entries
  const imageEntry = (p.media_gallery_entries || []).find((e) => e.types?.includes("image"));
  const imageUrl   = imageEntry
    ? `${BASE_URL}/pub/media/catalog/product${imageEntry.file}`
    : "";

  return {
    name:          p.name || "",
    price,
    originalPrice: origPrice && origPrice > price ? origPrice : null,
    discount:      origPrice && origPrice > price
      ? `-${Math.round((1 - price / origPrice) * 100)}%`
      : null,
    sku:           p.sku  || null,
    unit:          null,
    imageUrl,
    productUrl,
    inStock:       p.extension_attributes?.is_in_stock ?? (p.status === 1),
  };
}

// ─── Magento 2 DOM extractor ──────────────────────────────────────────────────
// Selector reference: Magento 2 app/code/Magento/Catalog/view/frontend/templates/product/list.phtml

function extractMagentoProducts() {
  const cleanPrice = (raw) => {
    const n = parseFloat((raw || "").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  // Primary Magento 2 product card selector
  // <li class="item product product-item">
  let cards = document.querySelectorAll("li.item.product.product-item");

  // Fallback selectors in order of specificity
  if (!cards.length) cards = document.querySelectorAll(".product-item");
  if (!cards.length) cards = document.querySelectorAll(".products-grid .product-item, .products-list .product-item");
  if (!cards.length) cards = document.querySelectorAll("[class*='product-item']");

  return Array.from(cards).map((card) => {
    // ── Name ──
    // Magento 2: <strong class="product-item-name"><a class="product-item-link">
    const nameLinkEl = card.querySelector(".product-item-name a.product-item-link, .product-item-link");
    const nameEl     = card.querySelector(".product-item-name, .product-name");
    const name       = nameLinkEl?.textContent?.trim()
                    || nameLinkEl?.getAttribute("title")
                    || nameEl?.textContent?.trim()
                    || "";
    if (!name) return null;

    // ── Product URL ──
    const linkEl    = card.querySelector("a.product-item-link, a.product-item-photo, a");
    const productUrl = linkEl?.href || "";

    // ── Price ──
    // Magento 2: <span class="price-box price-final_price">
    //   <span class="price-container price-final_price">
    //     <span class="price">৳XXX</span>
    // Sale: <span class="special-price"> + <span class="old-price">
    const specialPriceEl = card.querySelector(".special-price .price, .price-final_price .price");
    const oldPriceEl     = card.querySelector(".old-price .price, .regular-price .price");
    const anyPriceEl     = card.querySelector(".price-box .price, .price");

    const price     = cleanPrice(specialPriceEl?.textContent || anyPriceEl?.textContent);
    const origPrice = cleanPrice(oldPriceEl?.textContent);

    // ── Image ──
    // Magento 2: <img class="product-image-photo"> inside <a class="product-item-photo">
    const imgEl    = card.querySelector("img.product-image-photo, .product-item-photo img, img");
    const imageUrl = imgEl?.src
                  || imgEl?.getAttribute("data-src")
                  || imgEl?.getAttribute("data-original")
                  || imgEl?.getAttribute("data-lazy")
                  || "";

    // ── Discount badge ──
    // Magento 2 themes: <span class="sale-label">, <span class="new-label"> etc
    const badgeEl  = card.querySelector(".sale-label, .onsale, [class*='sale-badge'], [class*='percent']");
    const discount = badgeEl?.textContent?.trim() || null;

    return {
      name,
      price,
      originalPrice: origPrice && origPrice > price ? origPrice : null,
      discount:      discount || (origPrice && price && origPrice > price
        ? `-${Math.round((1 - price / origPrice) * 100)}%`
        : null),
      unit:          null,
      imageUrl:      imageUrl.startsWith("//") ? "https:" + imageUrl : imageUrl,
      productUrl,
    };
  }).filter(Boolean);
}

// ─── Check total pages from Magento toolbar ───────────────────────────────────

function extractPaginationInfo() {
  // Magento 2 toolbar: <span class="toolbar-number"> or <p class="toolbar-amount">
  const toolbarEl = document.querySelector(".toolbar-amount, .toolbar-number, [data-ui-id='page-title-wrapper']");
  const countText = toolbarEl?.textContent || "";
  const match     = countText.match(/(\d[\d,]*)\s+(?:item|product|result)/i);
  const total     = match ? parseInt(match[1].replace(/,/g, "")) : 0;

  // Also check "Last" page link
  const lastLink  = document.querySelector(".pages-item-last a, a.next, .action.next");
  const lastPage  = lastLink ? parseInt(lastLink.href?.match(/[?&]p=(\d+)/)?.[1] || "1") : 1;

  return { total, lastPage };
}

// ─── Magento 2 REST API search ────────────────────────────────────────────────

async function tryMagentoRestSearch(page, keyword, pageNum = 1) {
  const pageSize = 24;

  // Magento 2 quick search REST endpoint
  const url = `${BASE_URL}/rest/V1/search?`
    + `searchCriteria[requestName]=quick_search_container`
    + `&searchCriteria[filterGroups][0][filters][0][field]=search_term`
    + `&searchCriteria[filterGroups][0][filters][0][value]=${encodeURIComponent(keyword)}`
    + `&searchCriteria[filterGroups][0][filters][0][conditionType]=eq`
    + `&searchCriteria[pageSize]=${pageSize}`
    + `&searchCriteria[currentPage]=${pageNum}`;

  const data = await safeFetchInline(page, url);
  if (!data?.items?.length) return null;

  // REST search returns minimal items — we need to fetch each product individually
  // or use the products endpoint with IDs
  const ids = data.items.map((i) => i.id).filter(Boolean);
  if (!ids.length) return null;

  // Fetch product details for found IDs
  const productsUrl = `${BASE_URL}/rest/V1/products?`
    + `searchCriteria[filterGroups][0][filters][0][field]=entity_id`
    + `&searchCriteria[filterGroups][0][filters][0][value]=${ids.join(",")}`
    + `&searchCriteria[filterGroups][0][filters][0][conditionType]=in`
    + `&searchCriteria[pageSize]=${pageSize}`;

  const products = await safeFetchInline(page, productsUrl);
  if (products?.items?.length) {
    return products.items.map(normalizeMagentoProduct);
  }

  // Fallback: return whatever minimal data we got from the search
  return data.items.map((i) => ({
    name:          i.name || "",
    price:         i.price || null,
    originalPrice: null,
    discount:      null,
    unit:          null,
    imageUrl:      "",
    productUrl:    i.url_key ? `${BASE_URL}/${i.url_key}.html` : "",
    sku:           i.sku || null,
    inStock:       true,
  }));
}

// ─── Browse (category / homepage) ────────────────────────────────────────────

async function scrapeBasket(shopUrl = `${BASE_URL}`, pages = 1) {
  const page    = await newPage();
  const results = [];

  try {
    await injectSafeFetch(page);
    await navigateTo(page, shopUrl);

    // Try Magento REST API for products listing
    const apiUrl  = `${BASE_URL}/rest/V1/products?searchCriteria[pageSize]=30&searchCriteria[currentPage]=1&searchCriteria[filterGroups][0][filters][0][field]=status&searchCriteria[filterGroups][0][filters][0][value]=1`;
    const apiData = await safeFetchInline(page, apiUrl);

    if (apiData?.items?.length > 0) {
      results.push(...apiData.items.map(normalizeMagentoProduct));

      for (let p = 2; p <= pages; p++) {
        const moreUrl  = apiUrl.replace("currentPage]=1", `currentPage]=${p}`);
        const moreData = await safeFetchInline(page, moreUrl);
        if (!moreData?.items?.length) break;
        results.push(...moreData.items.map(normalizeMagentoProduct));
        await sleep(DELAY);
      }
    } else {
      // DOM fallback
      await autoScroll(page);
      const dom = await page.evaluate(extractMagentoProducts);
      results.push(...dom);

      for (let p = 2; p <= pages; p++) {
        const url = `${shopUrl}?p=${p}`;
        await navigateTo(page, url);
        await autoScroll(page);
        const more = await page.evaluate(extractMagentoProducts);
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

async function searchBasket(keyword, pages = 1) {
  if (!keyword?.trim()) return [];

  const page    = await newPage();
  const results = [];

  try {
    await injectSafeFetch(page);

    // Navigate to Magento search URL (correct URL for TheBasketBD)
    const searchUrl = `${BASE_URL}/catalogsearch/result/?q=${encodeURIComponent(keyword.trim())}`;
    
    await navigateTo(page, searchUrl);
    await autoScroll(page);
    await sleep(1000); // let Magento JS hydrate search results
    
    // ── Strategy 1: Magento 2 REST search API ──────────────────────────────
    const apiResults = await tryMagentoRestSearch(page, keyword.trim(), 1);
    if (apiResults && apiResults.length > 0) {
      results.push(...apiResults);

      for (let p = 2; p <= pages; p++) {
        const more = await tryMagentoRestSearch(page, keyword.trim(), p);
        if (!more || more.length === 0) break;
        results.push(...more);
        await sleep(DELAY);
      }
    } else {
      // ── Strategy 2: DOM scraping on the catalogsearch/result page ─────────
      const dom = await page.evaluate(extractMagentoProducts);
      results.push(...dom);

      if (dom.length > 0 && pages > 1) {
        // Check pagination
        const paginationInfo = await page.evaluate(extractPaginationInfo);

        for (let p = 2; p <= Math.min(pages, paginationInfo.lastPage || pages); p++) {
          const nextUrl = `${searchUrl}&p=${p}`;
          await navigateTo(page, nextUrl);
          await autoScroll(page);
          const more = await page.evaluate(extractMagentoProducts);
          if (!more.length) break;
          results.push(...more);
          await sleep(DELAY);
        }
      }
    }
  } catch (error) {
    console.log('An error occurred:', error.message);
  }
  finally {
    await page.close();
  }

  // Deduplicate by name (in case API and DOM overlap)
  
  const seen = new Set();
  return results
    .filter((p) => {
      if (!p.name) return false;
      const key = p.name.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({ ...p, source: SOURCE_NAME, category: "Grocery" }));
}

module.exports = { scrapeBasket, searchBasket };
