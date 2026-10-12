/**
 * Superuser Admin Guard Middleware
 * Release 3.2.3 - Access Enforcement for Administrative Endpoints
 */

export function adminGuard(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Superuser privileges required to perform this action'
    });
  }
  next();
}
