const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * A case (پرونده) mirrors one on-chain escrow created by IslamicEscrow.sol.
 * amountWei is stored as a STRING because wei values exceed JS Number range.
 */
const STATUS = ['FUNDED', 'DISPUTED', 'RESOLVED_EMPLOYER', 'RESOLVED_CONTRACTOR'];

const Case = sequelize.define(
  'Case',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    employerAddress: { type: DataTypes.STRING(42), allowNull: false }, // کارفرما
    contractorAddress: { type: DataTypes.STRING(42), allowNull: false }, // مجری
    amountWei: { type: DataTypes.STRING(78), allowNull: false },
    escrowId: { type: DataTypes.INTEGER, allowNull: true, unique: true }, // on-chain id
    status: {
      type: DataTypes.ENUM(...STATUS),
      allowNull: false,
      defaultValue: 'FUNDED',
    },
    fundingTxHash: { type: DataTypes.STRING(66) },
    resolveTxHash: { type: DataTypes.STRING(66) },
    decisionNote: { type: DataTypes.TEXT }, // internal note written by the council
    resolvedBy: { type: DataTypes.STRING(42) },
  },
  {
    tableName: 'cases',
    indexes: [
      { fields: ['employerAddress'] },
      { fields: ['contractorAddress'] },
      { fields: ['status'] },
    ],
  }
);

/** True when `address` is the employer or the contractor of this case. */
Case.prototype.involves = function involves(address) {
  if (!address) return false;
  const a = String(address).toLowerCase();
  return (
    this.employerAddress.toLowerCase() === a ||
    this.contractorAddress.toLowerCase() === a
  );
};

Case.STATUSES = STATUS;

module.exports = Case;
