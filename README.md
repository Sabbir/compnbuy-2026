# Daraz Scraper API

A production-ready REST API that scrapes product data from **daraz.com.bd** using **Puppeteer** (headless Chromium) and **Express**.

---

## Project Structure

```
daraz-scraper-api/
├── server.js                    ← Entry point — starts HTTP server, warms up browser
├── .env.example                 ← Copy to .env and customise
├── package.json
└── src/
    ├── app.js                   ← Express app: middleware + route mounting
    ├── browser/
    │   ├── browserManager.js    ← Singleton Puppeteer browser instance
    │   └── pageHelpers.js       ← navigate(), autoScroll(), withPage()
    ├── scrapers/
    │   ├── listingScraper.js    ← scrapeSearch() + scrapeCategory()
    │   └── detailScraper.js     ← scrapeDetails([urls])
    ├── routes/
    │   ├── healthRoutes.js      ← GET /health
    │   ├── searchRoutes.js      ← GET /api/search
    │   ├── categoryRoutes.js    ← GET /api/category
    │   └── productRoutes.js     ← GET /api/product  +  POST /api/product/bulk
    ├── middleware/
    │   ├── requestLogger.js     ← Colourised method/path/status/ms logging
    │   ├── errorHandler.js      ← Central error handler + asyncHandler() wrapper
    │   └── rateLimiter.js       ← IP-based rate limiting (express-rate-limit)
    └── utils/
        ├── response.js          ← success(), badRequest(), serverError() helpers
        ├── validators.js        ← isValidDarazUrl(), parsePages()
        └── cache.js             ← In-memory cache (node-cache) with TTL
```

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Start the server
npm start
# or with auto-restart on file changes:
npm run dev
```

The browser warms up automatically on startup so the first real request is fast.

---

## API Reference

### `GET /health`

Returns server liveness, browser status, and cache stats.

```json
{
  "status": "ok",
  "uptime": "42.3s",
  "browser": { "status": "up", "version": "Chrome/124.0.0.0" },
  "cache":   { "hits": 12, "misses": 3, "keys": 3 },
  "timestamp": "2026-04-17T10:00:00.000Z"
}
```

---

### `GET /api/search`

Scrape product listings by keyword.

| Query param | Type   | Required | Default | Notes          |
|-------------|--------|----------|---------|----------------|
| `q`         | string | ✅       | —       | Search keyword |
| `pages`     | number | ❌       | `1`     | Max `10`       |

```bash
curl "http://localhost:3000/api/search?q=laptop&pages=2"
```

```json
{
  "status": "success",
  "query": "laptop",
  "pages": 2,
  "count": 48,
  "cached": false,
  "data": [
    {
      "title": "HP Pavilion 15",
      "price": 72000,
      "originalPrice": 85000,
      "discount": "-15%",
      "rating": "4.5",
      "reviewCount": 182,
      "imageUrl": "https://...",
      "productUrl": "https://www.daraz.com.bd/products/..."
    }
  ]
}
```

---

### `GET /api/category`

Scrape a Daraz category listing page.

| Query param | Type   | Required | Default | Notes                          |
|-------------|--------|----------|---------|--------------------------------|
| `url`       | string | ✅       | —       | Full daraz.com.bd category URL |
| `pages`     | number | ❌       | `1`     | Max `10`                       |

```bash
curl "http://localhost:3000/api/category?url=https://www.daraz.com.bd/mobiles-tablets/&pages=2"
```

---

### `GET /api/product`

Scrape a single product detail page.

| Query param | Type   | Required |
|-------------|--------|----------|
| `url`       | string | ✅       |

```bash
curl "http://localhost:3000/api/product?url=https://www.daraz.com.bd/products/some-item.html"
```

```json
{
  "status": "success",
  "cached": false,
  "data": {
    "url": "https://...",
    "title": "Samsung Galaxy A55 5G",
    "price": 42999,
    "originalPrice": 49999,
    "discount": "-14%",
    "brand": "Samsung",
    "rating": "4.7",
    "reviewCount": 238,
    "description": "...",
    "specifications": {
      "RAM": "8GB",
      "Storage": "256GB",
      "Battery": "5000mAh"
    },
    "images": ["https://..."],
    "scrapedAt": "2026-04-17T10:00:00.000Z"
  }
}
```

---

### `POST /api/product/bulk`

Scrape up to **20** product detail pages in one request.

```bash
curl -X POST http://localhost:3000/api/product/bulk \
  -H "Content-Type: application/json" \
  -d '{ "urls": ["https://www.daraz.com.bd/products/a.html", "https://www.daraz.com.bd/products/b.html"] }'
```

```json
{
  "status": "success",
  "count": 2,
  "cached": false,
  "data": [ { ... }, { ... } ]
}
```

---

## Configuration (`.env`)

| Variable                    | Default       | Description                              |
|-----------------------------|---------------|------------------------------------------|
| `PORT`                      | `3000`        | HTTP port                                |
| `NODE_ENV`                  | `development` | Set to `production` to hide stack traces |
| `PAGE_TIMEOUT`              | `30000`       | ms before page navigation times out     |
| `PAGE_DELAY`                | `2000`        | ms pause between consecutive pages      |
| `WAIT_AFTER_LOAD`           | `2500`        | ms extra wait for JS hydration           |
| `CACHE_TTL`                 | `300`         | Seconds to cache each response           |
| `CACHE_ENABLED`             | `true`        | Set `false` to disable caching           |
| `RATE_LIMIT_WINDOW`         | `60000`       | ms sliding window for rate limiting      |
| `RATE_LIMIT_MAX`            | `30`          | Max requests per window per IP           |
| `PUPPETEER_EXECUTABLE_PATH` | auto-detect   | Override Chrome binary path              |

---

## Error Responses

All errors follow the same shape:

```json
{ "status": "error", "message": "Human-readable reason" }
```

| HTTP | Meaning                              |
|------|--------------------------------------|
| 400  | Bad input (missing/invalid params)   |
| 404  | Route not found                      |
| 429  | Rate limit exceeded                  |
| 500  | Scrape failed or internal error      |
| 503  | Browser is down (`/health` only)     |
