const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const apiRoutes = require('./routes');
const pagesRoutes = require('./routes/pages');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

// --- security headers -------------------------------------------------
// CSP note: Tailwind is loaded from the CDN and injects <style> at runtime,
// all app JavaScript lives in static files (no inline scripts).
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://cdn.tailwindcss.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '256kb' }));

// --- signed-cookie session (holds SIWE nonce + logged-in address) -------
app.use(
  cookieSession({
    name: 'hc_session',
    keys: [env.sessionSecret],
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: 24 * 60 * 60 * 1000,
  })
);

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: env.isProd ? '1h' : 0 }));

// --- API rate limiting --------------------------------------------------
app.use(
  '/api',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false })
);

app.use('/api', apiRoutes);
app.use('/', pagesRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
