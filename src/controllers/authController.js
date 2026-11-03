const siwe = require('../services/siweService');
const env = require('../config/env');
const { User } = require('../models');

/** GET /api/auth/nonce?address=0x… — build the SIWE message server-side. */
async function getNonce(req, res, next) {
  try {
    const address = String(req.query.address || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      return res.status(400).json({ error: 'آدرس کیف پول نامعتبر است.' });
    }
    const nonce = siwe.createNonce();
    req.session.nonce = nonce; // one-time, verified on /verify, then consumed

    const message = siwe.buildMessage({
      domain: req.get('host'),
      address,
      uri: `${req.protocol}://${req.get('host')}/login`,
      chainId: env.chainId,
      nonce,
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    return res.json({ message, nonce });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/auth/verify { message, signature } — verify SIWE signature. */
async function verify(req, res, next) {
  try {
    const { message, signature } = req.body || {};
    const result = siwe.verifySignIn({
      message,
      signature,
      expectedNonce: req.session ? req.session.nonce : null,
      host: req.get('host'),
    });
    if (result.error) return res.status(401).json({ error: result.error });

    delete req.session.nonce; // nonce is single-use

    const address = result.address;
    const role = env.isAdminAddress(address) ? 'admin' : 'user';

    const [user] = await User.findOrCreate({ where: { address }, defaults: { role } });
    if (user.role !== role) await user.update({ role });
    await user.update({ lastLoginAt: new Date() });

    req.session.address = address;
    req.session.role = role;
    return res.json({ address, role });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/auth/me */
function me(req, res) {
  if (!req.session || !req.session.address) return res.json({ address: null, role: null });
  return res.json({ address: req.session.address, role: req.session.role });
}

/** POST /api/auth/logout */
function logout(req, res) {
  req.session = null;
  return res.json({ ok: true });
}

module.exports = { getNonce, verify, me, logout };
