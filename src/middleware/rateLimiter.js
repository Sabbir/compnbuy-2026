/**
 * rateLimiter.js
 * Prevents abuse by capping requests per IP within a sliding window.
 * Configured via env vars: RATE_LIMIT_WINDOW, RATE_LIMIT_MAX
 */

const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60_000, // 1 minute
  max:      parseInt(process.env.RATE_LIMIT_MAX)    || 30,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    status:  "error",
    message: "Too many requests — please slow down and try again shortly.",
  },
  skip: (req) => req.path === "/health", // health checks are always free
});

module.exports = limiter;
