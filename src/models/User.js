const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Users are identified by their Ethereum wallet (SIWE login).
 * The role is derived from ADMIN_ADDRESSES in .env and stored as a snapshot.
 */
const User = sequelize.define(
  'User',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    address: {
      type: DataTypes.STRING(42),
      allowNull: false,
      unique: true,
      validate: { is: /^0x[0-9a-fA-F]{40}$/ },
    },
    role: {
      type: DataTypes.ENUM('user', 'admin'),
      allowNull: false,
      defaultValue: 'user',
    },
    lastLoginAt: { type: DataTypes.DATE },
  },
  {
    tableName: 'users',
    indexes: [{ unique: true, fields: ['address'] }],
  }
);

module.exports = User;
