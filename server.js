/**
 * server.js
 * Entry point — starts the HTTP server and warms up the browser.
 */

const app = require("./src/app");
const { getBrowser, closeBrowser } = require("./src/browser/browserManager");

const PORT = parseInt(process.env.PORT) || 3000;

async function start() {
  // Warm up the browser so the first request isn't slow
  console.log("[Server] Warming up browser...");
  await getBrowser();

  const server = app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║      Daraz + Grocery Scraper API  —  port :${PORT}      ║`);
    console.log(`╚══════════════════════════════════════════════════════╝`);
    console.log(`\n  ── Daraz ──────────────────────────────────────────`);
    console.log(`  GET  http://localhost:${PORT}/api/search?q=smartphone&pages=1`);
    console.log(`  GET  http://localhost:${PORT}/api/category?url=<url>&pages=1`);
    console.log(`  GET  http://localhost:${PORT}/api/product?url=<url>`);
    console.log(`  POST http://localhost:${PORT}/api/product/bulk`);
    console.log(`\n  ── Grocery ─────────────────────────────────────────`);
    console.log(`  GET  http://localhost:${PORT}/api/grocery/sources`);
    console.log(`  GET  http://localhost:${PORT}/api/grocery/all`);
    console.log(`  GET  http://localhost:${PORT}/api/grocery/search?q=rice&source=all`);
    console.log(`  GET  http://localhost:${PORT}/api/grocery/chaldal`);
    console.log(`  GET  http://localhost:${PORT}/api/grocery/thebasketbd`);
    console.log(`  GET  http://localhost:${PORT}/api/grocery/meenabazaar`);
    console.log(`  GET  http://localhost:${PORT}/api/grocery/meenabazaar/categories`);
    console.log(`\n  ── Clothing ────────────────────────────────────────`);
    console.log(`  GET  http://localhost:${PORT}/api/clothing/sources`);
    console.log(`  GET  http://localhost:${PORT}/api/clothing/all`);
    console.log(`  GET  http://localhost:${PORT}/api/clothing/blucheez`);
    console.log(`  GET  http://localhost:${PORT}/api/clothing/fabrilife`);
    console.log(`  GET  http://localhost:${PORT}/api/clothing/twelvebd`);
    console.log(`  GET  http://localhost:${PORT}/api/clothing/:source/categories`);
    console.log(`\n  ── Electronics ─────────────────────────────────────`);
    console.log(`  GET  http://localhost:${PORT}/api/electronics/sources`);
    console.log(`  GET  http://localhost:${PORT}/api/electronics/all`);
    console.log(`  GET  http://localhost:${PORT}/api/electronics/search?q=laptop`);
    console.log(`  GET  http://localhost:${PORT}/api/electronics/startech`);
    console.log(`  GET  http://localhost:${PORT}/api/electronics/ryans`);
    console.log(`  GET  http://localhost:${PORT}/api/electronics/vertech`);
    console.log(`  GET  http://localhost:${PORT}/api/electronics/:source/categories`);
    console.log(`\n  GET  http://localhost:${PORT}/health\n`);
  });

  // ─── Graceful shutdown ───────────────────────────────────────────────────
  async function shutdown(signal) {
    console.log(`\n[Server] ${signal} received — shutting down...`);
    server.close(async () => {
      await closeBrowser();
      console.log("[Server] Goodbye.");
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("[Server] Failed to start:", err.message);
  process.exit(1);
});
