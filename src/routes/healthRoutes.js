/**
 * healthRoutes.js
 * GET /health  — liveness, browser status, and cache stats
 */

const { Router } = require("express");
const { getBrowser } = require("../browser/browserManager");
const { stats: cacheStats } = require("../utils/cache");

const router = Router();
const startedAt = new Date().toISOString();

router.get("/", async (req, res) => {
  let browserVersion = null;
  let browserStatus  = "down";

  try {
    const browser  = await getBrowser();
    browserVersion = await browser.version();
    browserStatus  = "up";
  } catch { /* browser not running */ }

  const status = browserStatus === "up" ? 200 : 503;

  res.status(status).json({
    status:    browserStatus === "up" ? "ok" : "degraded",
    uptime:    process.uptime().toFixed(1) + "s",
    startedAt,
    browser:   { status: browserStatus, version: browserVersion },
    cache:     cacheStats(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
