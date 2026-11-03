/**
 * HakamChain (حَکَم‌چین) — MVP entry point.
 * Boots SQLite, initializes the Web3 layer and starts Express.
 */
const app = require('./app');
const env = require('./config/env');
const models = require('./models');
const blockchain = require('./services/blockchainService');

(async () => {
  const missing = env.validate();
  if (missing.length) {
    console.warn(
      `[env] Missing variables: ${missing.join(', ')}\n` +
        '      (tolerated in development — see .env.example)'
    );
  }
  if (!env.sessionSecret) {
    // Ephemeral dev-only secret: sessions reset on restart.
    env.sessionSecret = require('crypto').randomBytes(32).toString('hex');
    console.warn('[env] SESSION_SECRET not set — using an ephemeral secret (dev only).');
  }

  await models.sync();
  console.log('[db] SQLite ready');

  blockchain.init();

  app.listen(env.port, () => {
    console.log('==================================================');
    console.log('  حَکَم‌چین (HakamChain) MVP');
    console.log(`  → http://localhost:${env.port}`);
    console.log(`  Network: Ethereum Sepolia (chainId ${env.chainId})`);
    console.log('==================================================');
  });
})().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
