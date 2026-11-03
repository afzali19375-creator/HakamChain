const { Case, Evidence } = require('../models');
const blockchain = require('../services/blockchainService');
const { serializeCase } = require('../utils/helpers');

/** GET /api/admin/cases — all cases (council dashboard). */
async function listAllCases(req, res, next) {
  try {
    const cases = await Case.findAll({
      order: [['createdAt', 'DESC']],
      include: [{ model: Evidence, as: 'evidence' }],
    });
    return res.json({ cases: cases.map(serializeCase) });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/admin/cases/:id — one case with evidence (council review). */
async function getCaseDetail(req, res, next) {
  try {
    const found = await Case.findByPk(req.params.id, {
      include: [{ model: Evidence, as: 'evidence' }],
    });
    if (!found) return res.status(404).json({ error: 'پرونده یافت نشد.' });
    return res.json({ case: serializeCase(found) });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/admin/resolve { caseId, decision: 'EMPLOYER'|'CONTRACTOR', note }
 *
 * The heart of the platform: the council (حَکَم) rules after reviewing the
 * evidence, and the BACKEND WALLET executes the ruling on-chain by calling
 * IslamicEscrow.releaseFunds(escrowId, toEmployer) on Sepolia.
 */
async function resolve(req, res, next) {
  try {
    const { caseId, decision, note } = req.body || {};
    if (!caseId) return res.status(400).json({ error: 'شناسه پرونده الزامی است.' });
    if (!['EMPLOYER', 'CONTRACTOR'].includes(decision)) {
      return res.status(400).json({ error: 'تصمیم باید EMPLOYER یا CONTRACTOR باشد.' });
    }

    const found = await Case.findByPk(Number(caseId));
    if (!found) return res.status(404).json({ error: 'پرونده یافت نشد.' });
    if (!['FUNDED', 'DISPUTED'].includes(found.status)) {
      return res.status(400).json({ error: 'این پرونده قبلاً حل‌وفصل شده است.' });
    }
    if (found.escrowId == null) {
      return res.status(400).json({ error: 'این پرونده به قرارداد هوشمند متصل نیست.' });
    }

    const toEmployer = decision === 'EMPLOYER';
    const tx = await blockchain.releaseFunds(found.escrowId, toEmployer);

    await found.update({
      status: toEmployer ? 'RESOLVED_EMPLOYER' : 'RESOLVED_CONTRACTOR',
      resolveTxHash: tx.txHash,
      decisionNote: note ? String(note).slice(0, 1000) : null,
      resolvedBy: req.session.address,
    });

    return res.json({ case: serializeCase(found), tx });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listAllCases, getCaseDetail, resolve };
