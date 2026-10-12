/**
 * Centralized JSON Error Handler Middleware
 * Release 3.2.3 - Consistent JSON Error Boundaries
 */

export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[ERROR BOUNDARY] [${req.method} ${req.originalUrl}]`, err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(status).json({
    success: false,
    error: message
  });
}
