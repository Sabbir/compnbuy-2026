/**
 * app.js
 * Express application — middleware stack + route mounting.
 */

require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const helmet  = require("helmet");

const requestLogger = require("./middleware/requestLogger");
const { errorHandler } = require("./middleware/errorHandler");
const rateLimiter   = require("./middleware/rateLimiter");

const healthRoutes   = require("./routes/healthRoutes");
const searchRoutes   = require("./routes/searchRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const productRoutes  = require("./routes/productRoutes");
const groceryRoutes  = require("./routes/groceryRoutes");
const clothingRoutes    = require("./routes/clothingRoutes");
const electronicsRoutes = require("./routes/electronicsRoutes");

const app = express();

// ─── Security & parsing ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(requestLogger);
app.use(rateLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/health",       healthRoutes);
app.use("/api/search",   searchRoutes);
app.use("/api/category", categoryRoutes);
app.use("/api/product",  productRoutes);
app.use("/api/grocery",  groceryRoutes);
app.use("/api/clothing",    clothingRoutes);
app.use("/api/electronics", electronicsRoutes);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    status:  "error",
    message: `Route ${req.method} ${req.originalUrl} not found`,
    routes: [
      "GET  /health",
      "GET  /api/search?q=<keyword>&pages=<n>",
      "GET  /api/category?url=<daraz-category-url>&pages=<n>",
      "GET  /api/product?url=<daraz-product-url>",
      "POST /api/product/bulk  body: { urls: string[] }",
      "GET  /api/grocery/sources",
      "GET  /api/grocery/all?pages=<n>",
      "GET  /api/grocery/search?q=<keyword>&source=<chaldal|thebasketbd|meenabazaar|all>&pages=<n>",
      "GET  /api/grocery/:source?url=<override>&pages=<n>  (source: chaldal|thebasketbd|meenabazaar)",
      "GET  /api/grocery/meenabazaar/categories",
      "GET  /api/clothing/sources",
      "GET  /api/clothing/all?pages=<n>",
      "GET  /api/clothing/:source?url=<override>&pages=<n>  (source: blucheez|fabrilife|twelvebd)",
      "GET  /api/clothing/:source/categories",
      "GET  /api/electronics/sources",
      "GET  /api/electronics/all?pages=<n>",
      "GET  /api/electronics/search?q=<keyword>&source=<startech|ryans|all>",
      "GET  /api/electronics/:source?url=<override>&pages=<n>  (source: startech|ryans|vertech)",
      "GET  /api/electronics/:source/categories",
    ],
  });
});

// ─── Central error handler ────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
