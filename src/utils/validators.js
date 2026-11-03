const { isAddress } = require('ethers');

/** 0x + 64 hex chars — used for SHA-256 file hashes and tx hashes. */
const isHex64 = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);

const isSha256 = isHex64;
const isTxHash = isHex64;

const isValidAddress = (value) => typeof value === 'string' && isAddress(value);

module.exports = { isAddress: isValidAddress, isSha256, isTxHash };
