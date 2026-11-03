/**
 * HakamChain — End-to-End test against a LOCAL Hardhat chain + local API.
 *
 * Simulates the real product flow with 4 wallets:
 *   admin       (= contract owner / platform حَکَم / backend wallet)
 *   employer    (کارفرما — locks funds like MetaMask would)
 *   contractor  (مجری — delivers work, declares dispute)
 *   stranger    (attacker — must be rejected everywhere)
 *
 * Flow under test:
 *   SIWE login → deposit params from backend → on-chain createEscrow →
 *   POST /api/cases (backend verifies the tx on-chain) → evidence hashes →
 *   on-chain declareDispute → council resolves → backend wallet executes
 *   releaseFunds → on-chain + balance verification → pages render.
 *
 * Run:  bash test/run-e2e.sh
 */
const crypto = require('crypto');
const fs = require('fs');
const { ethers } = require('ethers');

const API = 'http://127.0.0.1:3000';
const RPC = 'http://127.0.0.1:8545';
const CHAIN_ID = 31337;

// Well-known Hardhat development keys — LOCAL TEST ONLY, never real funds.
const KEYS = {
  admin: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  employer: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  contractor: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  stranger: '0xde9be858da4a475276426320d5e1536607a510c28de057d63ef8c541066c7523',
};

const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const wallets = Object.fromEntries(
  Object.entries(KEYS).map(([k, pk]) => [k, new ethers.Wallet(pk, provider)])
);

const artifact = JSON.parse(
  fs.readFileSync('./artifacts/contracts/IslamicEscrow.sol/IslamicEscrow.json', 'utf8')
);
const deployment = JSON.parse(fs.readFileSync('./deployments/localhost.json', 'utf8'));
const escrow = new ethers.Contract(deployment.address, artifact.abi, provider);

// --- tiny cookie-jar HTTP client (one jar per actor) --------------------
function makeClient() {
  const jar = new Map();
  return async function api(method, path, body) {
    const headers = {};
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0];
      const idx = pair.indexOf('=');
      jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* HTML pages */ }
    return { status: res.status, json, text: json ? '' : text, location: res.headers.get('location') };
  };
}

const clients = {
  admin: makeClient(),
  employer: makeClient(),
  contractor: makeClient(),
  stranger: makeClient(),
};

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function siweLogin(actor, wallet) {
  const api = clients[actor];
  const address = wallet.address.toLowerCase();
  const nonceRes = await api('GET', `/api/auth/nonce?address=${address}`);
  if (nonceRes.status !== 200 || !nonceRes.json?.message) {
    throw new Error(`nonce request failed: ${JSON.stringify(nonceRes.json)}`);
  }
  const signature = await wallet.signMessage(nonceRes.json.message);
  return api('POST', '/api/auth/verify', { message: nonceRes.json.message, signature });
}

async function sendTx(wallet, to, data, value) {
  const tx = await wallet.sendTransaction({ to, data, value, gasLimit: 400000 });
  return tx.wait(1);
}

const sha256 = (s) => `0x${crypto.createHash('sha256').update(s).digest('hex')}`;
const DEPOSIT = ethers.parseEther('0.01');

// Raw RPC reads — bypass any ethers provider caching.
const rawBalance = async (addr) => BigInt(await provider.send('eth_getBalance', [addr, 'latest']));

(async () => {
  console.log('\n═══ HakamChain E2E — قرارداد + بک‌اند + پنل، روی زنجیره محلی ═══\n');
  console.log('── ۱) سلامت سرور و اتصال بلاکچین ──');

  const health = await clients.stranger('GET', '/api/health');
  check('GET /api/health → ok', health.status === 200 && health.json?.ok === true);

  const cfg = await clients.stranger('GET', '/api/config');
  check(
    'GET /api/config → web3Ready و آدرس قرارداد تنظیم شده',
    cfg.status === 200 && cfg.json?.web3Ready === true && String(cfg.json?.contractAddress || '').startsWith('0x'),
    JSON.stringify(cfg.json)
  );

  console.log('\n── ۲) احراز هویت SIWE ──');
  const a = await siweLogin('admin', wallets.admin);
  check('ورود ادمین (حَکَم) → role=admin', a.status === 200 && a.json?.role === 'admin', JSON.stringify(a.json));
  const e = await siweLogin('employer', wallets.employer);
  check('ورود کارفرما → role=user', e.status === 200 && e.json?.role === 'user', JSON.stringify(e.json));
  const c = await siweLogin('contractor', wallets.contractor);
  check('ورود مجری → role=user', c.status === 200 && c.json?.role === 'user', JSON.stringify(c.json));

  const forged = await clients.stranger('POST', '/api/auth/verify', { message: 'x', signature: `0x${'0'.repeat(130)}` });
  check('امضای جعلی رد می‌شود (401)', forged.status === 401);

  console.log('\n── ۳) واریز وجه در قرارداد هوشمند (نقش MetaMask کارفرما) ──');
  const params = await clients.employer('GET', `/api/contracts/create-escrow-params?contractor=${wallets.contractor.address}`);
  check(
    'بک‌اند calldata واریز را ساخت',
    params.status === 200 && params.json?.to?.toLowerCase() === deployment.address.toLowerCase() && params.json?.data?.startsWith('0x'),
    JSON.stringify(params.json)
  );

  const receipt = await sendTx(wallets.employer, params.json.to, params.json.data, DEPOSIT);
  check('تراکنش createEscrow ماین شد', receipt.status === 1, `tx ${receipt.hash}`);
  const fundedEvent = receipt.logs
    .map((l) => { try { return escrow.interface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; } })
    .find((p) => p?.name === 'EscrowFunded');
  check('رویداد EscrowFunded ساطع شد (id=1)', Boolean(fundedEvent) && Number(fundedEvent.args.id) === 1);

  console.log('\n── ۴) ثبت پرونده در بک‌اند (با تأیید تراکنش روی زنجیره) ──');
  const fake = await clients.employer('POST', '/api/cases', {
    title: 'تست جعلی',
    description: 'تلاش برای ثبت تراکنش ساختگی',
    contractorAddress: wallets.contractor.address,
    txHash: `0x${'ab'.repeat(32)}`,
  });
  check('txHash ساختگی رد شد (400)', fake.status === 400);

  const caseRes = await clients.employer('POST', '/api/cases', {
    title: 'طراحی و ساخت فروشگاه آنلاین',
    description: 'کارفرما ۰.۰۱ اتر بابت ساخت فروشگاه واریز کرده است؛ تحویل کار مورد اختلاف است.',
    contractorAddress: wallets.contractor.address,
    txHash: receipt.hash,
  });
  check('POST /api/cases → 201 و وضعیت FUNDED', caseRes.status === 201 && caseRes.json?.case?.status === 'FUNDED', JSON.stringify(caseRes.json));
  const caseId = caseRes.json?.case?.id;
  check('مبلغ از زنجیره خوانده شد (0.01 ETH)', caseRes.json?.case?.amountWei === DEPOSIT.toString());
  check('escrowId روی زنجیره = 1', Number(caseRes.json?.case?.escrowId) === 1);

  const dup = await clients.employer('POST', '/api/cases', {
    title: 'تست تکراری',
    description: 'ثبت دوباره همان تراکنش واریز',
    contractorAddress: wallets.contractor.address,
    txHash: receipt.hash,
  });
  check('ثبت دوباره همان تراکنش → 409', dup.status === 409);

  console.log('\n── ۵) بارگذاری مدرک (فقط هش SHA-256) ──');
  const ev1 = await clients.employer('POST', `/api/cases/${caseId}/evidence`, {
    fileHash: sha256('contract.pdf — قرارداد امضاشده توسط طرفین'),
    fileName: 'contract.pdf',
    note: 'قرارداد اولیه پروژه',
  });
  check('کارفرما مدرک ثبت کرد', ev1.status === 201, JSON.stringify(ev1.json));
  const ev2 = await clients.contractor('POST', `/api/cases/${caseId}/evidence`, {
    fileHash: sha256('delivery-proof.png — اسکرین‌شات کار تحویل‌شده'),
    fileName: 'delivery-proof.png',
  });
  check('مجری مدرک ثبت کرد', ev2.status === 201);
  const ev3 = await clients.stranger('POST', `/api/cases/${caseId}/evidence`, { fileHash: sha256('fake-evidence') });
  check('غریبه اجازه ثبت مدرک ندارد (401/403)', ev3.status === 401 || ev3.status === 403, `got ${ev3.status}`);

  console.log('\n── ۶) اعلام اختلاف رسمی روی زنجیره ──');
  const dParams = await clients.contractor('GET', `/api/contracts/dispute-params?caseId=${caseId}`);
  check('بک‌اند calldata اعلام اختلاف را ساخت', dParams.status === 200 && dParams.json?.data?.startsWith('0x'), JSON.stringify(dParams.json));
  const dReceipt = await sendTx(wallets.contractor, dParams.json.to, dParams.json.data, 0n);
  check('تراکنش declareDispute ماین شد', dReceipt.status === 1);
  const dRes = await clients.contractor('POST', `/api/cases/${caseId}/dispute`, { txHash: dReceipt.hash });
  check('وضعیت پرونده → DISPUTED', dRes.status === 200 && dRes.json?.case?.status === 'DISPUTED', JSON.stringify(dRes.json));

  console.log('\n── ۷) کنترل دسترسی ──');
  const s = await clients.stranger('GET', `/api/cases/${caseId}`);
  check('غریبه جزئیات پرونده را نمی‌بیند (401/403)', s.status === 401 || s.status === 403, `got ${s.status}`);
  const notAdmin = await clients.employer('GET', '/api/admin/cases');
  check('کاربر عادی به API ادمین دسترسی ندارد (403)', notAdmin.status === 403);

  console.log('\n── ۸) داوری شورای حَکَم و اجرای حکم روی زنجیره ──');
  const list = await clients.admin('GET', '/api/admin/cases');
  const listed = list.json?.cases?.find((x) => x.id === caseId);
  check('داشبورد ادمین پرونده را با ۲ مدرک نشان می‌دهد', list.status === 200 && Boolean(listed) && listed.evidence?.length === 2);

  const balC1 = await rawBalance(wallets.contractor.address);
  const resolve = await clients.admin('POST', '/api/admin/resolve', {
    caseId,
    decision: 'CONTRACTOR',
    note: 'مستندات تحویل کار معتبر است؛ بنا بر نظر شورا وجه به مجری آزاد می‌شود.',
  });
  check('POST /api/admin/resolve → RESOLVED_CONTRACTOR', resolve.status === 200 && resolve.json?.case?.status === 'RESOLVED_CONTRACTOR', JSON.stringify(resolve.json));
  const resolveTxHash = resolve.json?.tx?.txHash;
  check('بک‌اند هش تراکنش releaseFunds را برگرداند', typeof resolveTxHash === 'string' && resolveTxHash.startsWith('0x'), String(resolveTxHash));

  console.log('\n── ۹) راستی‌آزمایی نهایی روی بلاکچین ──');
  const onChain = await escrow.getEscrow(1);
  check('روی زنجیره: status=2 (ReleasedToContractor)', Number(onChain.status) === 2);
  check('روی زنجیره: مبلغ قفل‌شده صفر شد', onChain.amount === 0n);
  const rcpt = await provider.send('eth_getTransactionReceipt', [resolveTxHash]);
  const relEv = rcpt.logs
    .map((l) => { try { return escrow.interface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; } })
    .find((p) => p?.name === 'FundsReleased');
  check(
    'رویداد FundsReleased روی زنجیره: گیرنده = مجری، مبلغ = ۰.۰۱ اتر',
    Boolean(relEv) && relEv.args.contractor.toLowerCase() === wallets.contractor.address.toLowerCase() && relEv.args.amount === DEPOSIT,
    JSON.stringify(relEv ? { to: relEv.args.contractor, amount: relEv.args.amount.toString() } : null)
  );
  const balC2 = await rawBalance(wallets.contractor.address);
  check('وجه ۰.۰۱ اتر دقیقاً به کیف مجری رسید', balC2 - balC1 === DEPOSIT, `${ethers.formatEther(balC2 - balC1)} ETH`);
  const again = await clients.admin('POST', '/api/admin/resolve', { caseId, decision: 'EMPLOYER' });
  check('حکم دوباره روی پرونده حل‌شده رد می‌شود (400)', again.status === 400);

  console.log('\n── ۱۰) خروج از حساب ──');
  await clients.employer('POST', '/api/auth/logout');
  const me = await clients.employer('GET', '/api/auth/me');
  check('پس از logout سشن خالی است', me.json?.address === null, JSON.stringify(me.json));

  console.log('\n── ۱۱) صفحات پنل (EJS) ──');
  const login = await clients.stranger('GET', '/login');
  check('صفحه ورود رندر شد (۲۰۰ + محتوای فارسی)', login.status === 200 && login.text.includes('حَکَم‌چین'));
  const denied = await clients.employer('GET', '/admin');
  check('غیرادمین از داشبورد ادمین رد می‌شود (302 → login)', denied.status === 302 && String(denied.location).includes('/login'));
  const dash = await clients.admin('GET', '/admin');
  check('داشبورد حَکَم پرونده را نشان می‌دهد', dash.status === 200 && dash.text.includes('طراحی و ساخت فروشگاه آنلاین'));
  const detail = await clients.admin('GET', `/admin/cases/${caseId}`);
  check('صفحه جزئیات پرونده رندر شد (حکم به نفع مجری)', detail.status === 200 && detail.text.includes('به نفع مجری'));
  const noCookie = await makeClient()('GET', '/admin');
  check('بدون لاگین → ریدایرکت به /login', noCookie.status === 302);

  console.log('\n──────────────────────────────');
  console.log(`  نتیجه: ${pass} موفق، ${fail} ناموفق`);
  console.log('──────────────────────────────\n');
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('E2E crashed:', err);
  process.exit(1);
});
