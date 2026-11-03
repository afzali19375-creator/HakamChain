const router = require('express').Router();
const rateLimit = require('express-rate-limit');

const { requireAuth, requireAdmin } = require('../middlewares/auth');
const authController = require('../controllers/authController');
const caseController = require('../controllers/caseController');
const evidenceController = require('../controllers/evidenceController');
const adminController = require('../controllers/adminController');
const blockchain = require('../services/blockchainService');
const env = require('../config/env');
const { Case } = require('../models');
const { isAddress } = require('../utils/validators');

// --- health & config -------------------------------------------------
router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

router.get('/config', async (req, res, next) => {
  try {
    const maxDepositWei = (await blockchain.maxDepositWei()).toString();
    res.json({
      chainId: env.chainId,
      contractAddress: env.contractAddress || null,
      adminPanelEnabled: env.adminAddresses.length > 0,
      maxDepositWei,
      web3Ready: blockchain.isReady(),
    });
  } catch (err) {
    next(err);
  }
});

// --- SIWE authentication ----------------------------------------------
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40 });
router.post('/auth/verify', authLimiter, authController.verify);
router.post('/auth/logout', authController.logout);
router.get('/auth/me', authController.me);
// `address` is public on-chain data; building the message server-side
// prevents clients from injecting foreign domains into the SIWE payload.
router.get('/auth/nonce', authLimiter, authController.getNonce);

// --- cases -------------------------------------------------------------
router.post('/cases', requireAuth, caseController.createCase);
router.get('/cases', requireAuth, caseController.listMyCases);
router.get('/cases/:id', requireAuth, caseController.getCase);
router.post('/cases/:id/dispute', requireAuth, caseController.declareDispute);
router.post('/cases/:id/evidence', requireAuth, evidenceController.addEvidence);

// --- transaction params (backend encodes calldata with ethers) ----------
router.get('/contracts/create-escrow-params', requireAuth, async (req, res, next) => {
  try {
    const contractor = String(req.query.contractor || '').toLowerCase();
    if (!isAddress(contractor)) {
      return res.status(400).json({ error: 'آدرس مجری نامعتبر است.' });
    }
    if (contractor === req.session.address) {
      return res.status(400).json({ error: 'مجری نمی‌تواند خود کارفرما باشد.' });
    }
    const params = await blockchain.getDepositCalldata(contractor);
    return res.json(params); // { to, value, data }
  } catch (err) {
    return next(err);
  }
});

router.get('/contracts/dispute-params', requireAuth, async (req, res, next) => {
  try {
    const found = await Case.findByPk(req.query.caseId);
    if (!found) return res.status(404).json({ error: 'پرونده یافت نشد.' });
    if (!found.involves(req.session.address)) {
      return res.status(403).json({ error: 'شما طرف این پرونده نیستید.' });
    }
    if (found.status !== 'FUNDED') {
      return res.status(400).json({ error: 'در وضعیت فعلی امکان اعلام اختلاف وجود ندارد.' });
    }
    const params = await blockchain.getDisputeCalldata(found.escrowId);
    return res.json(params);
  } catch (err) {
    return next(err);
  }
});

// --- admin (council) — every route here is admin-only --------------------
router.get('/admin/cases', requireAdmin, adminController.listAllCases);
router.get('/admin/cases/:id', requireAdmin, adminController.getCaseDetail);
router.post('/admin/resolve', requireAdmin, adminController.resolve);

module.exports = router;
