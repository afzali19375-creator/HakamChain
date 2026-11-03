/**
 * HakamChain — frontend logic (vanilla JS, no build step).
 *
 * Talks to: window.ethereum (MetaMask) + this app's JSON API.
 * All JS lives in this static file so the CSP never needs 'unsafe-inline'
 * for scripts. Page-specific config is passed via
 * <script type="application/json" id="page-data"> (a non-executed data block).
 */
(() => {
  'use strict';

  // ------------------------------------------------------------------
  // tiny helpers
  // ------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const pageDataEl = document.getElementById('page-data');
  const PAGE = pageDataEl ? JSON.parse(pageDataEl.textContent) : {};

  // Network info comes from THIS server, so the same UI works both on the
  // real Sepolia testnet and on a local Hardhat chain (chainId 31337).
  // MetaMask network identity = RPC URL + chainId, so for the local chain we
  // offer to add a "HakamChain Local" network pointing at http://127.0.0.1:8545.
  let NET = null;
  const SEPOLIA_NET = {
    chainIdHex: '0xaa36a7', // 11155111
    name: 'Sepolia',
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
    explorer: ['https://sepolia.etherscan.io'],
  };
  const LOCAL_NET_TEMPLATE = (id) => ({
    chainIdHex: `0x${id.toString(16)}`,
    name: `HakamChain Local (${id})`,
    rpcUrls: ['http://127.0.0.1:8545'],
    explorer: [],
  });

  async function loadNetwork() {
    if (NET) return NET;
    try {
      const cfg = await api('/api/config');
      const id = Number(cfg.chainId) || 11155111;
      NET = id === 11155111 ? SEPOLIA_NET : LOCAL_NET_TEMPLATE(id);
    } catch {
      NET = SEPOLIA_NET;
    }
    return NET;
  }

  async function ensureNetwork() {
    const provider = await getWallet();
    const net = await loadNetwork();
    const current = await provider.request({ method: 'eth_chainId' });
    if (current === net.chainIdHex) return;
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: net.chainIdHex }],
      });
    } catch (err) {
      if (err && err.code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: net.chainIdHex,
              chainName: net.name,
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: net.rpcUrls,
              blockExplorerUrls: net.explorer,
            },
          ],
        });
      } else {
        throw new Error(`لطفاً کیف پول را روی شبکه ${net.name} قرار دهید.`);
      }
    }
  }

  async function getWallet() {
    if (!window.ethereum) {
      throw new Error('کیف پول یافت نشد. لطفاً افزونه MetaMask را نصب کنید.');
    }
    return window.ethereum;
  }

  async function connect() {
    const provider = await getWallet();
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts.length) throw new Error('هیچ حسابی در کیف پول انتخاب نشد.');
    await ensureNetwork();
    return accounts[0];
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) throw new Error(data.error || `خطای سرور (${res.status})`);
    return data;
  }

  function toast(message, ok = true) {
    let root = $('#toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toast-root';
      document.body.appendChild(root);
    }
    const el = document.createElement('div');
    el.className = `toast ${ok ? 'toast-ok' : 'toast-err'}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  function setBusy(btn, busy, busyText) {
    if (!btn) return;
    if (busy) {
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      if (busyText) btn.textContent = busyText;
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
    }
  }

  /** SHA-256 of a File, computed locally — the file never leaves the device. */
  async function sha256Hex(file) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('مرورگر شما از محاسبه امن هش پشتیبانی نمی‌کند (صفحه باید روی https یا localhost باشد).');
    }
    const buf = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest('SHA-256', buf);
    return `0x${Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
  }

  /** Decimal ETH string → wei BigInt (no floating point). */
  function ethToWei(ethStr) {
    const m = /^(\d+)(?:\.(\d+))?$/.exec(ethStr.trim());
    if (!m) throw new Error('مبلغ نامعتبر است. مثال: 0.01');
    const whole = m[1] || '0';
    let frac = m[2] || '';
    if (frac.length > 18) throw new Error('دقت مبلغ بیش از حد مجاز است.');
    frac = frac.padEnd(18, '0');
    return BigInt(whole) * 10n ** 18n + BigInt(frac);
  }

  const weiToEth = (wei) => `${(Number(BigInt(wei)) / 1e18).toString()} ETH`;

  function utf8ToHex(str) {
    return `0x${Array.from(new TextEncoder().encode(str))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
  }

  /** Ask the wallet to send a transaction; returns the tx hash. */
  async function sendTransaction({ to, value, data }) {
    const provider = await getWallet();
    const params = [
      {
        to,
        value: `0x${BigInt(value).toString(16)}`,
        data,
      },
    ];
    return provider.request({ method: 'eth_sendTransaction', params });
  }

  // ------------------------------------------------------------------
  // page: login (SIWE)
  // ------------------------------------------------------------------
  function initLogin() {
    const btn = $('#btn-connect-login');
    if (!btn) return;
    const status = $('#login-status');
    const say = (msg) => {
      if (status) status.textContent = msg;
    };

    btn.addEventListener('click', async () => {
      setBusy(btn, true, 'در حال اتصال…');
      try {
        say('اتصال کیف پول و بررسی شبکه…');
        const address = (await connect()).toLowerCase();

        say('دریافت پیام ورود (SIWE)…');
        const { message } = await api(`/api/auth/nonce?address=${encodeURIComponent(address)}`);

        say('لطفاً امضای پیام را در MetaMask تایید کنید…');
        const provider = await getWallet();
        const signature = await provider.request({
          method: 'personal_sign',
          params: [utf8ToHex(message), address],
        });

        say('بررسی امضا سمت سرور…');
        await api('/api/auth/verify', {
          method: 'POST',
          body: JSON.stringify({ message, signature }),
        });

        say('ورود موفق! در حال انتقال…');
        window.location.href = '/';
      } catch (err) {
        say('');
        toast(err.message || 'ورود ناموفق بود.', false);
        setBusy(btn, false);
      }
    });
  }

  // ------------------------------------------------------------------
  // page: user portal
  // ------------------------------------------------------------------
  function initPortal() {
    if (PAGE.page !== 'portal') return;
    fillMaxDepositHint();
    initCreateCaseForm();
    initDisputeButtons();
    initEvidenceForms();
  }

  async function fillMaxDepositHint() {
    const hint = $('#max-deposit-hint');
    if (!hint) return;
    try {
      const cfg = await api('/api/config');
      hint.textContent = weiToEth(cfg.maxDepositWei);
    } catch {
      /* keep server-rendered default */
    }
  }

  function initCreateCaseForm() {
    const form = $('#form-create-case');
    if (!form) return;
    const errorBox = $('#create-error');
    const submitBtn = form.querySelector('button[type="submit"]');
    const showError = (msg) => {
      errorBox.textContent = msg;
      errorBox.classList.remove('hidden');
    };
    const clearError = () => errorBox.classList.add('hidden');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();
      const title = $('#f-title').value.trim();
      const description = $('#f-desc').value.trim();
      const contractor = $('#f-contractor').value.trim().toLowerCase();
      const amountEth = $('#f-amount').value.trim();

      if (!/^0x[0-9a-f]{40}$/.test(contractor)) {
        return showError('آدرس کیف پول مجری نامعتبر است (باید به شکل 0x… ۴۲ کاراکتری باشد).');
      }

      let wei;
      try {
        wei = ethToWei(amountEth);
      } catch (err) {
        return showError(err.message);
      }
      if (wei === 0n) return showError('مبلغ باید بیشتر از صفر باشد.');

      setBusy(submitBtn, true, 'در حال آماده‌سازی تراکنش…');
      try {
        // Server-side amount cap check mirrors the contract's safe margin.
        const cfg = await api('/api/config');
        if (wei > BigInt(cfg.maxDepositWei)) {
          throw new Error(`سقف واریز ${weiToEth(cfg.maxDepositWei)} است (حاشیه امن تست‌نت).`);
        }
        const params = await api(
          `/api/contracts/create-escrow-params?contractor=${encodeURIComponent(contractor)}`
        );

        setBusy(submitBtn, true, 'تایید تراکنش در MetaMask…');
        const txHash = await sendTransaction({
          to: params.to,
          value: wei.toString(),
          data: params.data,
        });

        setBusy(submitBtn, true, 'در انتظار تایید شبکه (تا ~۹۰ ثانیه)…');
        await api('/api/cases', {
          method: 'POST',
          body: JSON.stringify({ title, description, contractorAddress: contractor, txHash }),
        });

        toast('پرونده با موفقیت ثبت شد و وجه در امانت قفل شد ✓');
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        showError(err.message || 'ثبت پرونده ناموفق بود.');
        setBusy(submitBtn, false);
      }
    });
  }

  function initDisputeButtons() {
    $$('.btn-dispute').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const caseId = btn.dataset.caseId;
        if (!window.confirm('اعلام اختلاف یعنی پرونده برای داوری حَکَم ارجاع می‌شود. ادامه می‌دهید؟')) return;
        setBusy(btn, true, 'در حال آماده‌سازی…');
        try {
          const params = await api(`/api/contracts/dispute-params?caseId=${encodeURIComponent(caseId)}`);
          setBusy(btn, true, 'تایید در MetaMask…');
          const txHash = await sendTransaction(params);
          setBusy(btn, true, 'در انتظار تایید شبکه…');
          await api(`/api/cases/${caseId}/dispute`, {
            method: 'POST',
            body: JSON.stringify({ txHash }),
          });
          toast('اعلام اختلاف ثبت شد؛ حَکَم پرونده را بررسی می‌کند ✓');
          setTimeout(() => window.location.reload(), 1200);
        } catch (err) {
          toast(err.message || 'اعلام اختلاف ناموفق بود.', false);
          setBusy(btn, false);
        }
      });
    });
  }

  function initEvidenceForms() {
    $$('.form-evidence').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const caseId = form.dataset.caseId;
        const input = form.querySelector('input[type="file"]');
        const note = (form.querySelector('.ev-note') || {}).value || '';
        const file = input.files && input.files[0];
        if (!file) return toast('ابتدا فایل شاهد را انتخاب کنید.', false);
        if (file.size > 20 * 1024 * 1024) {
          return toast('حجم فایل بیش از ۲۰ مگابایت است (برای دمو).', false);
        }
        const btn = form.querySelector('button[type="submit"]');
        setBusy(btn, true, 'در حال محاسبه هش SHA-256…');
        try {
          const fileHash = await sha256Hex(file);
          const data = await api(`/api/cases/${caseId}/evidence`, {
            method: 'POST',
            body: JSON.stringify({ fileHash, fileName: file.name, note: note.trim() }),
          });
          toast(`شاهد ثبت شد ✓ (${data.evidence.fileHash.slice(0, 10)}…)`);
          setTimeout(() => window.location.reload(), 1200);
        } catch (err) {
          toast(err.message || 'ثبت شاهد ناموفق بود.', false);
          setBusy(btn, false);
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // page: admin case detail (صدور حکم)
  // ------------------------------------------------------------------
  function initAdminCase() {
    if (PAGE.page !== 'admin-case') return;
    const resultBox = $('#resolve-result');
    const showResult = (msg, ok) => {
      if (!resultBox) return;
      resultBox.textContent = msg;
      resultBox.className = `text-sm rounded-xl px-4 py-3 ${
        ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'
      }`;
    };

    $$('.btn-resolve').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const decision = btn.dataset.decision; // 'EMPLOYER' | 'CONTRACTOR'
        const label = decision === 'EMPLOYER' ? 'بازپرداخت وجه به کارفرما' : 'آزادسازی وجه به مجری';
        if (
          !window.confirm(
            `حکم نهایی: ${label}\n\nبا تایید، تراکنش واقعی روی Sepolia از ولت ادمین ارسال می‌شود و غیرقابل بازگشت است. ادامه می‌دهید؟`
          )
        ) {
          return;
        }
        const note = ($('#decision-note') || {}).value || '';
        $$('.btn-resolve').forEach((b) => {
          b.disabled = true;
        });
        setBusy(btn, true, 'در حال ارسال تراکنش از ولت ادمین (انتظار برای ماین)…');
        try {
          const data = await api('/api/admin/resolve', {
            method: 'POST',
            body: JSON.stringify({ caseId: PAGE.caseId, decision, note: note.trim() }),
          });
          const short = data.tx.txHash.slice(0, 14);
          showResult(
            `حکم اجرا شد ✓ تراکنش: ${short}… (بازگشت به پرونده)`,
            true
          );
          setTimeout(() => window.location.reload(), 2200);
        } catch (err) {
          showResult(err.message || 'اجرای حکم ناموفق بود.', false);
          $$('.btn-resolve').forEach((b) => {
            b.disabled = false;
          });
          setBusy(btn, false);
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // global: logout + copy buttons + wallet account changes
  // ------------------------------------------------------------------
  function initGlobal() {
    document.addEventListener('click', async (e) => {
      const target = e.target;
      if (target && target.id === 'btn-logout') {
        try {
          await api('/api/auth/logout', { method: 'POST' });
        } catch {
          /* ignore */
        }
        window.location.href = '/login';
        return;
      }
      if (target && target.classList && target.classList.contains('btn-copy')) {
        const value = target.dataset.copy || '';
        try {
          await navigator.clipboard.writeText(value);
          const old = target.textContent;
          target.textContent = 'کپی شد ✓';
          setTimeout(() => {
            target.textContent = old;
          }, 1500);
        } catch {
          toast('کپی خودکار ممکن نشد؛ مقدار را دستی کپی کنید.', false);
        }
      }
    });

    if (window.ethereum && window.ethereum.on) {
      window.ethereum.on('accountsChanged', () => window.location.reload());
      window.ethereum.on('chainChanged', () => window.location.reload());
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initGlobal();
    initLogin();
    initPortal();
    initAdminCase();
  });
})();
