/**
 * errorHandler.js
 * Central Express error-handling middleware.
 * Catches anything passed to next(err) or unhandled throws in async routes.
 */

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error("[Error]", err.message);
  if (process.env.NODE_ENV !== "production") console.error(err.stack);

  res.status(err.status || 500).json({
    status: "error",
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
}

/**
 * Wraps an async route handler so errors are forwarded to errorHandler
 * without needing try/catch in every route.
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { errorHandler, asyncHandler };
