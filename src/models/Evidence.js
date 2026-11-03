const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Evidence (شواهد) — PRIVACY BY DESIGN:
 * only the SHA-256 hash of the evidence file is stored, never the file
 * itself. Hashing happens in the user's browser (WebCrypto) before the
 * request is sent, so confidential documents never leave the user's device.
 */
const Evidence = sequelize.define(
  'Evidence',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    caseId: { type: DataTypes.INTEGER, allowNull: false },
    uploaderAddress: { type: DataTypes.STRING(42), allowNull: false },
    fileHash: {
      type: DataTypes.STRING(66), // 0x + 64 hex chars (SHA-256)
      allowNull: false,
      validate: { is: /^0x[0-9a-fA-F]{64}$/ },
    },
    fileName: { type: DataTypes.STRING(255), allowNull: false },
    note: { type: DataTypes.STRING(500) },
  },
  {
    tableName: 'evidence',
    indexes: [{ fields: ['caseId'] }],
  }
);

module.exports = Evidence;
