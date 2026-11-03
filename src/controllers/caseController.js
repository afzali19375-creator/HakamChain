const { Op } = require('sequelize');
const { Case, Evidence } = require('../models');
const blockchain = require('../services/blockchainService');
const env = require('../config/env');
const { isAddress, isTxHash } = require('../utils/validators');
const { serializeCase } = require('../utils/helpers');

/**
 * POST /api/cases — employer creates a case AFTER sending the deposit tx.
 * Body: { title, description, contractorAddress, txHash }
 * The backend verifies the tx on-chain (EscrowFunded event) before saving,
 * so the DB always mirrors the chain — the client cannot fake amounts.
 */
async function createCase(req, res, next) {
  try {
    const employer = req.session.address;
    const { title, description, contractorAddress, txHash } = req.body || {};

    if (!title || title.trim().length < 3 || title.trim().length > 200) {
      return res.status(400).json({ error: 'عنوان پرونده باید بین ۳ تا ۲۰۰ کاراکتر باشد.' });
    }
    if (!description || description.trim().length < 10) {
      return res.status(400).json({ error: 'شرح پرونده باید حداقل ۱۰ کاراکتر باشد.' });
    }
    if (!isAddress(contractorAddress)) {
      return res.status(400).json({ error: 'آدرس مجری نامعتبر است.' });
    }
    const contractor = contractorAddress.toLowerCase();
    if (contractor === employer) {
      return res.status(400).json({ error: 'آدرس مجری نمی‌تواند همان کارفرما باشد.' });
    }
    if (!isTxHash(txHash)) {
      return res.status(400).json({ error: 'هش تراکنش واریز نامعتبر است.' });
    }

    const funding = await blockchain.verifyFundingTx(txHash);
    if (!funding) {
      return res.status(400).json({
        error: 'تراکنش واریز پیدا نشد یا هنوز تایید نشده است؛ پس از تایید در MetaMask دوباره تلاش کنید.',
      });
    }
    if (funding.employer.toLowerCase() !== employer) {
      return res.status(400).json({ error: 'واریزکننده تراکنش با حساب شما مطابقت ندارد.' });
    }
    if (funding.contractor.toLowerCase() !== contractor) {
      return res.status(400).json({ error: 'آدرس مجری داخل تراکنش با فرم مطابقت ندارد.' });
    }
    const duplicate = await Case.findOne({ where: { escrowId: funding.escrowId } });
    if (duplicate) {
      return res.status(409).json({ error: 'این پرونده قبلاً ثبت شده است.' });
    }

    const created = await Case.create({
      title: title.trim(),
      description: description.trim(),
      employerAddress: employer,
      contractorAddress: contractor,
      amountWei: funding.amountWei,
      escrowId: funding.escrowId,
      status: 'FUNDED',
      fundingTxHash: funding.txHash,
    });
    return res.status(201).json({ case: serializeCase(created) });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/cases — my cases (as employer or contractor). */
async function listMyCases(req, res, next) {
  try {
    const address = req.session.address;
    const cases = await Case.findAll({
      where: {
        [Op.or]: [{ employerAddress: address }, { contractorAddress: address }],
      },
      order: [['createdAt', 'DESC']],
      include: [{ model: Evidence, as: 'evidence' }],
    });
    return res.json({ cases: cases.map(serializeCase) });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/cases/:id — case detail (party or admin only). */
async function getCase(req, res, next) {
  try {
    const found = await Case.findByPk(req.params.id, {
      include: [{ model: Evidence, as: 'evidence' }],
    });
    if (!found) return res.status(404).json({ error: 'پرونده یافت نشد.' });
    const me = req.session.address;
    if (!found.involves(me) && !env.isAdminAddress(me)) {
      return res.status(403).json({ error: 'شما طرف این پرونده نیستید.' });
    }
    return res.json({ case: serializeCase(found) });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/cases/:id/dispute { txHash } — after the party sent the
 * declareDispute() tx from their wallet, the backend verifies it on-chain
 * and flips the case status to DISPUTED.
 */
async function declareDispute(req, res, next) {
  try {
    const found = await Case.findByPk(req.params.id);
    if (!found) return res.status(404).json({ error: 'پرونده یافت نشد.' });
    const me = req.session.address;
    if (!found.involves(me) && !env.isAdminAddress(me)) {
      return res.status(403).json({ error: 'شما طرف این پرونده نیستید.' });
    }
    if (found.status !== 'FUNDED') {
      return res.status(400).json({ error: 'در وضعیت فعلی امکان اعلام اختلاف وجود ندارد.' });
    }
    const { txHash } = req.body || {};
    if (!isTxHash(txHash)) {
      return res.status(400).json({ error: 'هش تراکنش اعلام اختلاف نامعتبر است.' });
    }
    const dispute = await blockchain.verifyDisputeTx(txHash, found.escrowId);
    if (!dispute) {
      return res.status(400).json({ error: 'تراکنش اعلام اختلاف روی زنجیره تایید نشد.' });
    }
    await found.update({ status: 'DISPUTED' });
    return res.json({ case: serializeCase(found) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createCase, listMyCases, getCase, declareDispute };
