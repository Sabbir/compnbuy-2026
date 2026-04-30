/**
 * cache.js
 * Thin wrapper around node-cache for caching scrape results in memory.
 * Keyed by a normalised string derived from the request params.
 *
 * Set CACHE_ENABLED=false in .env to bypass caching entirely.
 */

const NodeCache = require("node-cache");

const TTL     = parseInt(process.env.CACHE_TTL)  || 300;  // seconds
const ENABLED = process.env.CACHE_ENABLED !== "false";

const store = new NodeCache({ stdTTL: TTL, checkperiod: 60 });

/**
 * Build a deterministic cache key from arbitrary key-value pairs.
 * e.g. cacheKey("search", { q: "laptop", pages: 2 }) → "search:pages=2:q=laptop"
 */
function cacheKey(prefix, params = {}) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join(":");
  return `${prefix}:${sorted}`;
}

/**
 * Try cache first; if miss run loader() and store result.
 * @param {string}   key
 * @param {Function} loader  async () => data
 */
async function getOrFetch(key, loader) {
  if (!ENABLED) return loader();

  const cached = store.get(key);
  if (cached !== undefined) {
    console.log(`[Cache] HIT  ${key}`);
    return cached;
  }

  console.log(`[Cache] MISS ${key}`);
  const data = await loader();
  store.set(key, data);
  return data;
}

/** Manually invalidate a key (e.g. for testing). */
function invalidate(key) {
  store.del(key);
}

/** Current cache stats — exposed on /health. */
function stats() {
  return store.getStats();
}

module.exports = { cacheKey, getOrFetch, invalidate, stats };
