/**
 * SIWE (Sign-In with Ethereum, EIP-4361) — implemented directly with
 * ethers.js to keep the dependency surface minimal for this MVP.
 *
 * The server BUILDS the exact message (so the client cannot forge domains
 * or nonces) and only VERIFIES the signature afterwards:
 *
 *   GET /api/auth/nonce?address=0x…  ->  { message, nonce }   (nonce stored in session)
 *   POST /api/auth/verify            ->  { address, role }    (nonce consumed)
 */
const { verifyMessage } = require('ethers');
const crypto = require('crypto');
const env = require('../config/env');

const STATEMENT =
  'By signing this message you prove ownership of your Ethereum wallet ' +
  'for the HakamChain (HakamChain) arbitration platform. ' +
  'This is an off-chain login signature: it triggers no blockchain ' +
  'transaction and costs no gas.';

function buildMessage({ domain, address, uri, chainId, nonce, issuedAt, expirationTime }) {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    STATEMENT,
    '',
    `URI: ${uri}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expirationTime}`,
  ].join('\n');
}

function createNonce() {
  return crypto.randomBytes(16).toString('hex');
}

/** Minimal EIP-4361 message parser (server controls the template). */
function parseMessage(message) {
  const lines = String(message).split('\n');
  const pick = (prefix) => {
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : null;
  };
  return {
    domain: (lines[0] || '').split(' wants you to sign in')[0].trim(),
    address: (lines[1] || '').trim(),
    uri: pick('URI: '),
    version: pick('Version: '),
    chainId: Number(pick('Chain ID: ') || 0),
    nonce: pick('Nonce: '),
    issuedAt: pick('Issued At: '),
    expirationTime: pick('Expiration Time: '),
  };
}

/**
 * Verify message + signature against the session nonce and server origin.
 * @returns {{ address: string } | { error: string }}
 */
function verifySignIn({ message, signature, expectedNonce, host }) {
  if (!message || !signature) return { error: 'پیام یا امضا ارسال نشده است.' };

  let parsed;
  try {
    parsed = parseMessage(message);
  } catch {
    return { error: 'قالب پیام SIWE نامعتبر است.' };
  }

  let recovered;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    return { error: 'امضا معتبر نیست.' };
  }

  if (!parsed.address || parsed.address.toLowerCase() !== recovered.toLowerCase()) {
    return { error: 'امضا با آدرس داخل پیام مطابقت ندارد.' };
  }
  if (!expectedNonce || !parsed.nonce || parsed.nonce !== expectedNonce) {
    return { error: 'nonce نامعتبر یا منقضی شده است؛ دوباره وارد شوید.' };
  }
  if (parsed.chainId !== env.chainId) {
    return { error: `ورود فقط روی شبکه Sepolia (chainId ${env.chainId}) پذیرفته می‌شود.` };
  }
  if (parsed.uri) {
    try {
      if (new URL(parsed.uri).host !== host) {
        return { error: 'دامنه پیام ورود با سرور مطابقت ندارد.' };
      }
    } catch {
      return { error: 'URI داخل پیام ورود نامعتبر است.' };
    }
  }
  const issued = Date.parse(parsed.issuedAt || '');
  if (Number.isNaN(issued) || Date.now() - issued > 15 * 60 * 1000) {
    return { error: 'پیام ورود منقضی شده است؛ دوباره تلاش کنید.' };
  }
  if (parsed.expirationTime) {
    const exp = Date.parse(parsed.expirationTime);
    if (!Number.isNaN(exp) && exp < Date.now()) {
      return { error: 'پیام ورود منقضی شده است؛ دوباره تلاش کنید.' };
    }
  }

  return { address: parsed.address.toLowerCase() };
}

module.exports = { buildMessage, createNonce, verifySignIn };
