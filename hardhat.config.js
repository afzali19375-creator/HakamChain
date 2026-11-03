require('dotenv').config();
require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    sepolia: {
      chainId: 11155111,
      // Any Sepolia RPC works; the public one needs no API key.
      url: process.env.RPC_URL_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com',
      accounts: process.env.ADMIN_PRIVATE_KEY ? [process.env.ADMIN_PRIVATE_KEY] : [],
    },
  },
};
