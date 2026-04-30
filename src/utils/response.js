/**
 * response.js
 * Standardised JSON response helpers used across all route handlers.
 */

function success(res, data, meta = {}) {
  return res.status(200).json({
    status: "success",
    ...meta,
    data,
  });
}

function created(res, data) {
  return res.status(201).json({ status: "success", data });
}

function badRequest(res, message) {
  return res.status(400).json({ status: "error", message });
}

function notFound(res, message = "Resource not found") {
  return res.status(404).json({ status: "error", message });
}

function serverError(res, message = "Internal server error", detail = null) {
  const body = { status: "error", message };
  if (detail && process.env.NODE_ENV !== "production") body.detail = detail;
  return res.status(500).json(body);
}

module.exports = { success, created, badRequest, notFound, serverError };
