const { formatEther } = require('ethers');

const shortAddress = (address) =>
  address ? `${String(address).slice(0, 6)}…${String(address).slice(-4)}` : '';

function serializeEvidence(ev) {
  return {
    id: ev.id,
    caseId: ev.caseId,
    uploaderAddress: ev.uploaderAddress,
    fileHash: ev.fileHash,
    fileName: ev.fileName,
    note: ev.note,
    createdAt: ev.createdAt,
  };
}

function serializeCase(c) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    employerAddress: c.employerAddress,
    contractorAddress: c.contractorAddress,
    amountWei: c.amountWei,
    amountEth: formatEther(BigInt(c.amountWei)),
    escrowId: c.escrowId,
    status: c.status,
    fundingTxHash: c.fundingTxHash,
    resolveTxHash: c.resolveTxHash,
    decisionNote: c.decisionNote,
    resolvedBy: c.resolvedBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    evidence: c.evidence ? c.evidence.map(serializeEvidence) : undefined,
  };
}

const STATUS_FA = {
  FUNDED: 'سپرده‌شده',
  DISPUTED: 'در جریان داوری',
  RESOLVED_EMPLOYER: 'حکم: به نفع کارفرما',
  RESOLVED_CONTRACTOR: 'حکم: به نفع مجری',
};

const STATUS_CLASS = {
  FUNDED: 'bg-sky-50 text-sky-700 border-sky-200',
  DISPUTED: 'bg-amber-50 text-amber-700 border-amber-200',
  RESOLVED_EMPLOYER: 'bg-stone-100 text-stone-600 border-stone-200',
  RESOLVED_CONTRACTOR: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

module.exports = { shortAddress, serializeCase, serializeEvidence, STATUS_FA, STATUS_CLASS };
