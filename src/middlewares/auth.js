const env = require('../config/env');

/** API guard: any logged-in wallet (SIWE session). */
function requireAuth(req, res, next) {
  if (req.session && req.session.address) return next();
  return res.status(401).json({ error: 'ابتدا با کیف پول خود وارد شوید.' });
}

/** API guard: admin (platform حَکَم) only. */
function requireAdmin(req, res, next) {
  if (req.session && req.session.address && env.isAdminAddress(req.session.address)) {
    return next();
  }
  return res.status(403).json({ error: 'این بخش فقط برای ادمین (حَکَم) قابل دسترسی است.' });
}

/** Page guard (redirects instead of JSON errors). */
function requirePageAuth(req, res, next) {
  if (req.session && req.session.address) return next();
  return res.redirect('/login');
}

/** Page guard for the admin panel. */
function requirePageAdmin(req, res, next) {
  if (req.session && req.session.address && env.isAdminAddress(req.session.address)) {
    return next();
  }
  return res.redirect('/login');
}

module.exports = { requireAuth, requireAdmin, requirePageAuth, requirePageAdmin };
