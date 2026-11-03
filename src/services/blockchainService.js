/**
 * Blockchain service — the ONLY module that talks to Sepolia.
 *
 * Responsibilities:
 *  - Hold the admin wallet (platform حَکَم) that signs releaseFunds() txs.
 *  - Build transaction calldata for the user's wallet (deposit / dispute).
 *  - Verify user-submitted tx hashes against real on-chain events.
 *  - Execute the council's ruling (release to contractor / refund employer).
 *
 * SECURITY: the private key only ever lives in .env (never in code/git),
 * and the app refuses to start blockchain operations without it.
 */
const { ethers } = require('ethers');
const env = require('../config/env');

// Minimal human-readable ABI — only the functions/events the backend needs.
const ISLAMIC_ESCROW_ABI = [
  'function createEscrow(address contractor) external payable returns (uint256 id)',
  'function declareDispute(uint256 id) external',
  'function releaseFunds(uint256 id, bool toEmployer) external',
  'function getEscrow(uint256 id) external view returns (tuple(uint256,address,address,uint256,uint8,uint256))',
  'function nextEscrowId() external view returns (uint256)',
  'function MAX_DEPOSIT() external view returns (uint256)',
  'function owner() external view returns (address)',
  'event EscrowFunded(uint256 indexed id, address indexed employer, address indexed contractor, uint256 amount)',
  'event FundsReleased(uint256 indexed id, address indexed contractor, uint256 amount)',
  'event FundRefunded(uint256 indexed id, address indexed employer, uint256 amount)',
  'event DisputeDeclared(uint256 indexed id, address indexed by)',
];

let provider = null;
let adminWallet = null;
let contract = null;

/** Initialize the Web3 layer (safe to call even when unconfigured). */
function init() {
  if (contract) return;
  if (!env.adminPrivateKey || !env.contractAddress) {
    console.warn(
      '[web3] Blockchain operations disabled — set ADMIN_PRIVATE_KEY and ' +
        'CONTRACT_ADDRESS in .env after deploying the contract.'
    );
    return;
  }
  try {
    provider = new ethers.JsonRpcProvider(env.rpcUrl, env.chainId, { staticNetwork: true });
    adminWallet = new ethers.Wallet(env.adminPrivateKey, provider);
    contract = new ethers.Contract(env.contractAddress, ISLAMIC_ESCROW_ABI, adminWallet);
    console.log(`[web3] Ready — admin ${adminWallet.address} → contract ${env.contractAddress}`);
  } catch (err) {
    console.error('[web3] Initialization failed:', err.message);
  }
}

const isReady = () => Boolean(contract);

function requireReady() {
  if (!isReady()) {
    const err = new Error(
      'بلاکچین پیکربندی نشده است؛ ابتدا قرارداد را دیپلوی و CONTRACT_ADDRESS و ADMIN_PRIVATE_KEY را در .env تنظیم کنید.'
    );
    err.status = 503;
    throw err;
  }
}

/** On-chain safe margin (falls back to the .env mirror). */
async function maxDepositWei() {
  if (!isReady()) return env.maxDepositWei;
  try {
    return await contract.MAX_DEPOSIT();
  } catch {
    return env.maxDepositWei;
  }
}

/** Calldata for the employer's wallet to lock funds (createEscrow). */
async function getDepositCalldata(contractorAddress) {
  requireReady();
  return {
    to: await contract.getAddress(),
    value: '0',
    data: contract.interface.encodeFunctionData('createEscrow', [contractorAddress]),
  };
}

/** Calldata for a party's wallet to declare a dispute on-chain. */
async function getDisputeCalldata(escrowId) {
  requireReady();
  return {
    to: await contract.getAddress(),
    value: '0',
    data: contract.interface.encodeFunctionData('declareDispute', [escrowId]),
  };
}

/** Wait (up to `timeoutMs`) for a tx receipt with 1 confirmation. */
async function waitForReceipt(txHash, timeoutMs = 90_000) {
  if (!provider) requireReady();
  try {
    return await provider.waitForTransaction(txHash, 1, timeoutMs);
  } catch {
    return null;
  }
}

/** Parse all recognized IslamicEscrow events from a receipt. */
function parseLogs(receipt) {
  const parsed = [];
  for (const log of receipt.logs) {
    try {
      const p = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (p) parsed.push(p);
    } catch {
      // log from another contract — ignore
    }
  }
  return parsed;
}

/**
 * Verify a deposit tx: it must be mined, successful and emit EscrowFunded.
 * @returns {null | { escrowId, employer, contractor, amountWei, txHash }}
 */
async function verifyFundingTx(txHash) {
  requireReady();
  const receipt = await waitForReceipt(txHash);
  if (!receipt || receipt.status !== 1) return null;
  const event = parseLogs(receipt).find((p) => p.name === 'EscrowFunded');
  if (!event) return null;
  return {
    escrowId: Number(event.args.id),
    employer: event.args.employer,
    contractor: event.args.contractor,
    amountWei: event.args.amount.toString(),
    txHash: receipt.hash,
  };
}

/**
 * Verify a declareDispute tx for a specific escrow id.
 * @returns {null | { escrowId, declaredBy, txHash }}
 */
async function verifyDisputeTx(txHash, escrowId) {
  requireReady();
  const receipt = await waitForReceipt(txHash);
  if (!receipt || receipt.status !== 1) return null;
  const event = parseLogs(receipt).find((p) => p.name === 'DisputeDeclared');
  if (!event || Number(event.args.id) !== Number(escrowId)) return null;
  return {
    escrowId: Number(event.args.id),
    declaredBy: event.args.by,
    txHash: receipt.hash,
  };
}

/**
 * Execute the council ruling: send releaseFunds() from the admin wallet.
 * @param {number} escrowId  on-chain escrow id
 * @param {boolean} toEmployer true → refund employer, false → release to contractor
 */
async function releaseFunds(escrowId, toEmployer) {
  requireReady();
  const tx = await contract.releaseFunds(escrowId, toEmployer);
  const receipt = await tx.wait(1);
  if (receipt.status !== 1) {
    const err = new Error('تراکنش آزادسازی روی زنجیره شکست خورد.');
    err.status = 502;
    throw err;
  }
  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  };
}

/** Read one escrow from the chain (null if unconfigured/not found). */
async function getEscrow(escrowId) {
  if (!isReady()) return null;
  try {
    const e = await contract.getEscrow(escrowId);
    return {
      id: Number(e[0]),
      employer: e[1],
      contractor: e[2],
      amountWei: e[3].toString(),
      status: Number(e[4]),
      createdAt: Number(e[5]),
    };
  } catch {
    return null;
  }
}

module.exports = {
  ABI: ISLAMIC_ESCROW_ABI,
  init,
  isReady,
  maxDepositWei,
  getDepositCalldata,
  getDisputeCalldata,
  verifyFundingTx,
  verifyDisputeTx,
  releaseFunds,
  getEscrow,
  get address() {
    return adminWallet ? adminWallet.address : null;
  },
};
