const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Verifies the Bearer token on every protected route and attaches
// { id, email, role } to req.user.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Usage: requireRole('ADMIN', 'SUPER_ADMIN')
// Restricts a route to specific roles — mirrors the role-based access
// control described in section 3 / 30 of the project spec.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    next();
  };
}

// Usage: requirePermission('canAccessResignationsAdmin', 'ADMIN', 'SUPER_ADMIN')
// bypassRoles always pass (e.g. Admin/Super Admin never need the flag).
// Everyone else is checked FRESH from the database on every request —
// deliberately not read from the JWT payload, so that revoking a
// person's access takes effect immediately rather than only at their
// next login.
function requirePermission(permissionField, ...bypassRoles) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (bypassRoles.includes(req.user.role)) return next();
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { [permissionField]: true } });
    if (user && user[permissionField]) return next();
    return res.status(403).json({ error: 'You do not have permission to do this.' });
  };
}

// Usage: requireHrCapability('hrSeesResignations', requirePermission('canAccessResignationsAdmin', 'ADMIN', 'SUPER_ADMIN'))
// Admin/Super Admin always pass. HR passes unless Admin has switched this
// specific category off for HR globally (checked fresh from the DB, same
// freshness guarantee as requirePermission). Everyone else falls through
// to the provided fallback middleware (typically the existing per-person
// grant system) — so a Manager individually granted access still works.
function requireHrCapability(flagName, fallbackMiddleware) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) return next();
    if (req.user.role === 'HR') {
      const settings = await prisma.roleCapabilitySettings.findUnique({ where: { id: 'singleton' } });
      const allowed = !settings || settings[flagName] !== false; // default true if no row yet
      if (allowed) return next();
      return res.status(403).json({ error: 'Admin has restricted HR access to this.' });
    }
    return fallbackMiddleware(req, res, next);
  };
}

module.exports = { requireAuth, requireRole, requirePermission, requireHrCapability };
