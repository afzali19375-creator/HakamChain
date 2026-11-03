const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');
const env = require('./env');

// Make sure the SQLite directory exists before opening the database.
const storage = path.resolve(env.dbStorage);
fs.mkdirSync(path.dirname(storage), { recursive: true });

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage,
  logging: false,
});

module.exports = sequelize;
