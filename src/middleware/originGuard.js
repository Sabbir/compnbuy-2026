/**
 * originGuard.js
 * Two-layer API access protection:
 *
 * Layer 1 – CORS (handled in app.js via the corsOptions config exported here)
 *   Only the frontend origin is whitelisted; browsers block cross-origin requests.
 *
 * Layer 2 – Secret header check (this middleware)
 *   Every request must include X-API-Secret matching the value in .env.
 *   This blocks direct curl / Postman access that bypasses CORS entirely.
 *
 * Setup:
 *   1. Add  API_SECRET=<random-string>  to backend .env
 *   2. Add  VITE_API_SECRET=<same-string>  to frontend .env
 *   3. Add  ALLOWED_ORIGIN=https://compnbuy.com  to backend .env
 */

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Always allow localhost for local dev
const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
];

const ALL_ALLOWED = [...ALLOWED_ORIGINS, ...DEV_ORIGINS];

// ── CORS options ──────────────────────────────────────────────────────────────
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (health checks, same-origin server calls)
    if (!origin) return callback(null, true);

    if (ALL_ALLOWED.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-API-Secret", "ngrok-skip-browser-warning", "Accept"],
  optionsSuccessStatus: 200,
};

// ── Secret header middleware ──────────────────────────────────────────────────
const SECRET = process.env.API_SECRET || "";

function originGuard(req, res, next) {
  // Skip check if no secret is configured (dev fallback — warn in logs)
  if (!SECRET) {
    if (process.env.NODE_ENV !== "development") {
      console.warn("[originGuard] WARNING: API_SECRET is not set. All requests allowed.");
    }
    return next();
  }

  // /health is public — monitoring tools need it
  if (req.path === "/health" || req.path.startsWith("/health/")) {
    return next();
  }

  const incoming = req.headers["x-api-secret"];

  if (!incoming || incoming !== SECRET) {
    return res.status(403).json({
      status:  "error",
      message: "Forbidden: invalid or missing API secret.",
    });
  }

  next();
}

module.exports = { corsOptions, originGuard };
