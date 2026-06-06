/**
 * safeFetch.js
 *
 * Provides two approaches to safe in-browser JSON fetching:
 *
 * 1. injectSafeFetch(page)          — registers window.__safeFetch via
 *    evaluateOnNewDocument so it survives every navigation on that page.
 *
 * 2. safeFetchInline(page, url)     — Node-side helper that calls page.evaluate
 *    with the full safe fetch logic inline, no window injection required.
 *    Use this when you can't guarantee inject ran before the current context.
 *
 * Root cause of "Unexpected token '<'" errors:
 *   Calling response.json() or r.json() on a server that returned an HTML
 *   error page (403, 404, 500) instead of JSON silently throws because the
 *   body starts with "<!doctype" not "{" or "[".
 */

// ─── Inline safe fetch (serialised, passed to page.evaluate) ─────────────────

const SAFE_FETCH_SRC = /* js */ `
async function safeFetch(url, opts) {
  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      ...(opts || {})
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    const text = await r.text();
    const first = text.trimStart()[0];
    if (first !== '{' && first !== '[') return null;
    return JSON.parse(text);
  } catch { return null; }
}
`;

/**
 * Node-side wrapper: evaluates safeFetch inside the browser and returns result.
 * No prior injection needed — the function is passed inline every call.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @returns {Promise<any|null>}
 */
async function safeFetchInline(page, url) {
  return page.evaluate(
    new Function("url", `${SAFE_FETCH_SRC}\nreturn safeFetch(url);`),
    url
  );
}

/**
 * Registers window.__safeFetch via evaluateOnNewDocument so it is
 * automatically available after every navigation on this page instance.
 *
 * Call once per page, before the first navigation.
 *
 * @param {import('puppeteer').Page} page
 */
async function injectSafeFetch(page) {
  await page.evaluateOnNewDocument(`
    ${SAFE_FETCH_SRC}
    window.__safeFetch = safeFetch;
  `);
}

module.exports = { injectSafeFetch, safeFetchInline, SAFE_FETCH_SRC };
