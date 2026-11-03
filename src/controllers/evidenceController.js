const { Case, Evidence } = require('../models');
const env = require('../config/env');
const { isSha256 } = require('../utils/validators');
const { serializeEvidence } = require('../utils/helpers');

/**
 * POST /api/cases/:id/evidence { fileHash, fileName, note }
 * PRIVACY: only the SHA-256 hash (computed in the user's browser) reaches
 * the server. The evidence file itself is never uploaded.
 */
async function addEvidence(req, res, next) {
  try {
    const found = await Case.findByPk(req.params.id);
    if (!found) return res.status(404).json({ error: 'پرونده یافت نشد.' });

    const me = req.session.address;
    if (!found.involves(me) && !env.isAdminAddress(me)) {
      return res.status(403).json({ error: 'شما طرف این پرونده نیستید.' });
    }

    const { fileHash, fileName, note } = req.body || {};
    if (!isSha256(fileHash)) {
      return res.status(400).json({
        error: 'هش فایل باید SHA-256 و به شکل 0x… (۶۴ کاراکتر هگز) باشد.',
      });
    }
    const evidence = await Evidence.create({
      caseId: found.id,
      uploaderAddress: me,
      fileHash: fileHash.toLowerCase(),
      fileName: String(fileName || 'file').slice(0, 255),
      note: note ? String(note).slice(0, 500) : null,
    });
    return res.status(201).json({ evidence: serializeEvidence(evidence) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { addEvidence };
