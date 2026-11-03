function notFound(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'مسیر یافت نشد.' });
  }
  return res.status(404).send('صفحه یافت نشد.');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  const message = err.message || 'خطای سرور.';
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message });
  }
  return res.status(status).send(message);
}

module.exports = { notFound, errorHandler };
