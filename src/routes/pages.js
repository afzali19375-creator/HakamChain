/**
 * Server-rendered pages (EJS): login, user portal, admin panel.
 */
const router = require('express').Router();
const { Op } = require('sequelize');

const { requirePageAuth, requirePageAdmin } = require('../middlewares/auth');
const { Case, Evidence } = require('../models');
const env = require('../config/env');
const blockchain = require('../services/blockchainService');
const { serializeCase, STATUS_FA, STATUS_CLASS } = require('../utils/helpers');

router.get('/', (req, res) => {
  if (!req.session || !req.session.address) return res.redirect('/login');
  if (env.isAdminAddress(req.session.address)) return res.redirect('/admin');
  return res.redirect('/portal');
});

router.get('/login', (req, res) => {
  res.render('login', {
    title: 'ورود | حَکَم‌چین',
    address: null,
    pageData: { page: 'login', chainId: env.chainId, web3Ready: blockchain.isReady() },
  });
});

router.get('/portal', requirePageAuth, async (req, res, next) => {
  try {
    const address = req.session.address;
    const cases = await Case.findAll({
      where: {
        [Op.or]: [{ employerAddress: address }, { contractorAddress: address }],
      },
      order: [['createdAt', 'DESC']],
      include: [{ model: Evidence, as: 'evidence' }],
    });
    res.render('portal', {
      title: 'پرونده‌های من | حَکَم‌چین',
      address,
      role: req.session.role,
      cases: cases.map(serializeCase),
      statusFa: STATUS_FA,
      statusClass: STATUS_CLASS,
      pageData: { page: 'portal', chainId: env.chainId, web3Ready: blockchain.isReady() },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/admin', requirePageAdmin, async (req, res, next) => {
  try {
    const cases = await Case.findAll({
      order: [['createdAt', 'DESC']],
      include: [{ model: Evidence, as: 'evidence' }],
    });
    const serialized = cases.map(serializeCase);
    const stats = {
      total: serialized.length,
      open: serialized.filter((c) => ['FUNDED', 'DISPUTED'].includes(c.status)).length,
      resolved: serialized.filter((c) => c.status.startsWith('RESOLVED')).length,
    };
    res.render('admin/dashboard', {
      title: 'داشبورد حَکَم | حَکَم‌چین',
      address: req.session.address,
      role: req.session.role,
      cases: serialized,
      stats,
      statusFa: STATUS_FA,
      statusClass: STATUS_CLASS,
      pageData: { page: 'admin-dashboard', chainId: env.chainId, web3Ready: blockchain.isReady() },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/cases/:id', requirePageAdmin, async (req, res, next) => {
  try {
    const found = await Case.findByPk(req.params.id, {
      include: [{ model: Evidence, as: 'evidence' }],
    });
    if (!found) return res.status(404).send('پرونده یافت نشد.');
    res.render('admin/caseDetail', {
      title: `پرونده #${found.id} | حَکَم‌چین`,
      address: req.session.address,
      role: req.session.role,
      kase: serializeCase(found),
      statusFa: STATUS_FA,
      statusClass: STATUS_CLASS,
      pageData: {
        page: 'admin-case',
        caseId: found.id,
        chainId: env.chainId,
        web3Ready: blockchain.isReady(),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
