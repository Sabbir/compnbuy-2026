/**
 * requestLogger.js
 * Logs every incoming request with method, path, status, and duration.
 */

function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const color =
      status >= 500 ? "\x1b[31m" :
      status >= 400 ? "\x1b[33m" :
      status >= 200 ? "\x1b[32m" : "\x1b[36m";
    const reset = "\x1b[0m";
    console.log(`${color}${method} ${originalUrl} → ${status} (${ms}ms)${reset}`);
  });

  next();
}

module.exports = requestLogger;
