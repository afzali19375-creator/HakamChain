/**
 * Central environment configuration.
 * Every process env access lives here so nothing else touches process.env.
 */
require('dotenv').config();
const { parseEther } = require('ethers');

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '3000', 10),
  sessionSecret: process.env.SESSION_SECRET || '',

  // --- Blockchain (Ethereum Sepolia) ---
  chainId: parseInt(process.env.CHAIN_ID || '11155111', 10),
  rpcUrl: process.env.RPC_URL_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com',
  adminPrivateKey: (process.env.ADMIN_PRIVATE_KEY || '').trim(),
  contractAddress: (process.env.CONTRACT_ADDRESS || '').trim(),
  adminAddresses: (process.env.ADMIN_ADDRESSES || '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean),

  // --- Database ---
  dbStorage: process.env.DB_STORAGE || './data/hakamchain.sqlite',

  // --- Limits ---
  maxDepositEth: process.env.MAX_DEPOSIT_ETH || '0.05',
};

// Fallback mirror of the on-chain safe margin (MAX_DEPOSIT = 0.05 ether).
// Only used when the contract is not reachable yet.
env.maxDepositWei = parseEther(env.maxDepositEth);

// The backend can boot without blockchain config (UI-only demo mode),
// but resolving cases requires it.
env.isWeb3Configured = Boolean(env.adminPrivateKey && env.contractAddress);

env.isAdminAddress = (address) =>
  Boolean(address) && env.adminAddresses.includes(String(address).toLowerCase());

/**
 * Returns the list of missing critical variables.
 * In development we tolerate missing blockchain vars (warning only);
 * in production they are mandatory.
 */
env.validate = function validate() {
  const missing = [];
  if (!env.sessionSecret) missing.push('SESSION_SECRET');
  if (env.isProd) {
    if (!env.adminPrivateKey) missing.push('ADMIN_PRIVATE_KEY');
    if (!env.contractAddress) missing.push('CONTRACT_ADDRESS');
    if (env.adminAddresses.length === 0) missing.push('ADMIN_ADDRESSES');
  }
  return missing;
};

module.exports = env;
