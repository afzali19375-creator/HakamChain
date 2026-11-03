const { Sequelize } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');
const Case = require('./Case');
const Evidence = require('./Evidence');

// Associations
Case.hasMany(Evidence, { foreignKey: 'caseId', as: 'evidence' });
Evidence.belongsTo(Case, { foreignKey: 'caseId', as: 'case' });

/** Connect + create tables (MVP: sequelize.sync is enough). */
async function sync() {
  await sequelize.authenticate();
  await sequelize.sync();
}

module.exports = { sequelize, Sequelize, User, Case, Evidence, sync };
