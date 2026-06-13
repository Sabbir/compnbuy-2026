/**
 * validators.js
 * Input validation helpers for route handlers.
 */

function isValidDarazUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("daraz.com.bd");
  } catch {
    return false;
  }
}

const GROCERY_DOMAINS = [
  "chaldal.com",
  "thebasketbd.com",
  "meenabazaronline.com",
];

function isValidGroceryUrl(url) {
  try {
    const { hostname } = new URL(url);
    return GROCERY_DOMAINS.some((d) => hostname.endsWith(d));
  } catch {
    return false;
  }
}

function parsePages(raw, max = 10) {
  const n = parseInt(raw);
  if (isNaN(n) || n < 1) return 1;
  return Math.min(n, max);
}

const CLOTHING_DOMAINS = [
  "blucheez.fashion",
  "fabrilife.com",
  "twelvebd.com",
];

function isValidClothingUrl(url) {
  try {
    const { hostname } = new URL(url);
    return CLOTHING_DOMAINS.some((d) => hostname.endsWith(d));
  } catch {
    return false;
  }
}

const ELECTRONICS_DOMAINS = [
  "startech.com.bd",
  "ryans.com",
  "vertech.com.bd",
];

function isValidElectronicsUrl(url) {
  try {
    const { hostname } = new URL(url);
    return ELECTRONICS_DOMAINS.some((d) => hostname.endsWith(d));
  } catch { return false; }
}

module.exports = {
  isValidDarazUrl,
  isValidGroceryUrl,     GROCERY_DOMAINS,
  isValidClothingUrl,    CLOTHING_DOMAINS,
  isValidElectronicsUrl, ELECTRONICS_DOMAINS,
  parsePages,
};
