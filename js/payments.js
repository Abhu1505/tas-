// ============================================================
// 💳 PAYMENTS — client-portal payment options + outstanding balance
// ------------------------------------------------------------
// WHAT THIS FILE DOES
//   • Shows the amount due for the current month's sessions inside
//     the client portal ("💵 Amount due" tile + a dedicated
//     "💳 Pay For Your Sessions" card with a monthly statement).
//   • Adds real payment buttons:  Pay (Apple Pay) via the Apple Pay
//     JS API (passkit.js.apple.com) when the device/browser supports
//     it, plus Google Pay and generic Card (Visa/Mastercard/Amex)
//     buttons through Stripe's Payment Request API. When no payment
//     provider is configured, an "Offline / cash" button records the
//     payment locally so the flow still works end-to-end.
//   • The amount due is ONLY cleared once a payment completes
//     successfully (paid invoice rows in Supabase `client_payments`,
//     mirrored to localStorage while offline). Unpaid months are not
//     forgotten: their balance automatically CARRIES OVER and is added
//     to the next month's due amount until it is paid.
//
// BACKEND SETUP (one-time, safe & idempotent):
//   Run sql/client_payments.sql once in Supabase → SQL Editor. It
//   creates the `client_payments` table (+ RLS policies) and adds the
//   optional `payment_provider` / `stripe_publishable_key` columns to
//   `admin_config`. Until that migration exists everything degrades
//   gracefully to localStorage, so the portal never breaks.
//
// PROVIDER CONFIG (optional — enables Apple Pay / Google Pay / Card):
//   In js/config.js set:
//     PAYMENT_PROVIDER: 'stripe',                  // or 'apple_pay_direct'
//     STRIPE_PUBLISHABLE_KEY: 'pk_live_…',         // Stripe only
//     APPLE_PAY_MERCHANT_ID: 'merchant.com.…'      // Apple Pay Direct only
//   The same values can live in the admin_config row (cloud wins), so
//   the trainer can change them without redeploying.
//   NOTE: Apple Pay requires the site to be served over HTTPS from a
//   domain registered with the payment processor / Apple merchant
//   account. On unsupported browsers the Apple Pay button hides itself.
// ============================================================
(function () {
  'use strict';

  const $id = (x) => (typeof x === 'string' ? document.getElementById(x) : x);
  const CUR = () => (window.APP_CONFIG && APP_CONFIG.CURRENCY) || 'AED';
  const MONTH_KEYS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const _fallbackStoreKey = 'tas_client_payments_v1';

  // ---- tiny money helper --------------------------------------------------
  function fmtMoney(v) {
    const n = Math.round((Number(v) || 0) * 100) / 100;
    return `${CUR()} ${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  function monthKeyOf(y, m /* 0-based */) {
    return `${y}-${MONTH_KEYS[m]}`;
  }
  function parseMonthKey(k) {
    const [y, mm] = String(k || '').split('-').map(Number);
    if (!y || !mm) return null;
    return { y, m: mm - 1 };
  }
  function monthLabel(k) {
    const p = parseMonthKey(k);
    if (!p) return k;
    const names = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return `${names[p.m]} ${p.y}`;
  }
  function nowStamp() {
    try { return new Date().toLocaleString(); } catch (e) { return ''; }
  }
  function sameId(a, b) {
    return (typeof window.sameId === 'function') ? window.sameId(a, b) : String(a ?? '') === String(b ?? '');
  }

  // ---- local mirror of paid invoices (offline-first cache) ----------------
  function readLocalPayments() {
    try { return JSON.parse(localStorage.getItem(_fallbackStoreKey) || '[]'); }
    catch (e) { return []; }
  }
  function writeLocalPayments(list) {
    try { localStorage.setItem(_fallbackStoreKey, JSON.stringify(list.slice(-500))); } catch (e) {}
  }
  function addLocalPayment(rec) {
    const list = readLocalPayments();
    if (!list.some(p => p.invoice_key === rec.invoice_key && String(p.client_id) === String(rec.client_id))) list.push(rec);
    writeLocalPayments(list);
  }

  // Is a given (client, month) already settled? Checks the cloud rows first,
  // then the local mirror — so a completed payment clears the amount due
  // immediately, even before the next full data reload. A paid invoice row
  // covers EVERY month key it lists (combined invoices like
  // "2026-08+2026-09" clear both months at once).
  function isInvoicePaid(clientId, mk) {
    const covers = (p) => String(p.invoice_key || '').split('+').indexOf(mk) !== -1;
    const remote = (window.APP_STATE && APP_STATE.clientPayments) || [];
    if (remote.some(p => sameId(p.client_id, clientId) && covers(p) &&
      String(p.status || 'paid') === 'paid')) return true;
    return readLocalPayments().some(p => String(p.client_id) === String(clientId) && covers(p));
  }

  // ============================================================
  // BALANCE ENGINE — current month + carry-over of unpaid months
  // ============================================================
  // Returns { sessions, rate, monthDue, carryAmount, carryMonths[],
  //           totalDue, thisMonthPaid, allClear }
  window.getBalanceInfo = function (clientId, opts) {
    opts = opts || {};
    const empty = { sessions: 0, rate: 0, monthDue: 0, carryAmount: 0, carryMonths: [], totalDue: 0, thisMonthPaid: false, allClear: true };
    if (!clientId || typeof getSessions !== 'function' || typeof getRate !== 'function') return empty;

    const nowD = opts.asOfDate || new Date();
    const y = nowD.getFullYear(), m = nowD.getMonth();
    const rate = getRate(clientId);

    // 1 · Current month's session charges.
    const sessions = getSessions(clientId, y, m).length;
    const monthDue = sessions * rate;
    const curKey = monthKeyOf(y, m);
    const thisMonthPaid = isInvoicePaid(clientId, curKey);

    // 2 · Carry-over: every PAST month since billing began whose invoice was
    //     never paid. The session cache only holds ~3 years of history
    //     (matching loadAllData's date window), so we walk back through it
    //     and stop at the first fully-paid or empty month — older unpaid
    //     months are already settled by definition once that boundary is hit.
    const carry = [];
    let cy = y, cm = m - 1;
    if (cm < 0) { cm = 11; cy -= 1; }
    const stopYear = (opts.fromYear || (new Date().getFullYear() - 3));
    let guard = 0;
    while ((cy > stopYear || (cy === stopYear && cm >= 0)) && guard++ < 48) {
      const key = monthKeyOf(cy, cm);
      const n = getSessions(clientId, cy, cm).length;
      const amt = n * rate;
      if (amt > 0) {
        if (!isInvoicePaid(clientId, key)) {
          carry.push({ key, label: monthLabel(key), sessions: n, amount: amt });
        } else {
          break; // everything older than a settled month is settled too
        }
      }
      cm--; if (cm < 0) { cm = 11; cy--; }
    }
    const carryAmount = carry.reduce((s, c) => s + c.amount, 0);

    // 3 · Total due = unpaid past months + this month (cleared only on pay).
    const totalDue = carryAmount + (thisMonthPaid ? 0 : monthDue);
    return {
      sessions, rate, monthDue,
      carryAmount, carryMonths: carry.reverse(), // oldest first
      totalDue, thisMonthPaid,
      allClear: totalDue <= 0
    };
  };

  // ============================================================
  // DATA LOADING (Supabase `client_payments`; graceful fallback)
  // ============================================================
  window.loadClientPayments = async function () {
    if (!APP_STATE) return;
    APP_STATE.clientPayments = APP_STATE.clientPayments || [];
    const sb = APP_STATE.supabaseClient;
    if (!sb) return;
    try {
      const { data, error } = await sb.from('client_payments')
        .select('*').order('created_at', { ascending: false }).limit(2000);
      if (!error) { APP_STATE.clientPayments = data || []; APP_STATE.clientPaymentsCloudOk = true; }
      else {
        APP_STATE.clientPaymentsCloudOk = false;
        // Table missing? Try one-time auto-provision (needs service key) —
        // otherwise the localStorage mirror keeps the portal fully working.
        if (typeof window.isMissingTableError === 'function' && window.isMissingTableError(error) &&
          typeof window.ensureTableExists === 'function') {
          try { await window.ensureTableExists('client_payments'); } catch (e) {}
        }
      }
    } catch (e) {
      APP_STATE.clientPaymentsCloudOk = false;
      console.warn('loadClientPayments:', e);
    }
  };

  // Merge a freshly-paid invoice into the in-memory state right away so the
  // "Amount due" tile drops to zero instantly (no wait for a reload).
  function recordPaidLocally(clientId, mk, method, amount, ref) {
    const rec = {
      client_id: String(clientId), invoice_key: mk, amount_due: amount,
      currency: CUR(), method, reference: ref || '', status: 'paid',
      created_at: new Date().toISOString()
    };
    addLocalPayment(rec);
    if (APP_STATE.clientPayments) {
      if (!APP_STATE.clientPayments.some(p => sameId(p.client_id, clientId) && p.invoice_key === mk)) {
        APP_STATE.clientPayments.unshift(rec);
      }
    }
  }

  // Persist a completed payment. Cloud first; on failure fall back to the
  // local mirror and queue for retry so the balance still clears.
  function persistPayment(clientId, mk, method, amount, ref) {
    recordPaidLocally(clientId, mk, method, amount, ref);
    const sb = APP_STATE.supabaseClient;
    if (!sb) return Promise.resolve({ ok: true, cloud: false });
    return sb.from('client_payments').insert({
      client_id: String(clientId), invoice_key: mk, amount_due: amount,
      currency: CUR(), method, reference: ref || '', status: 'paid'
    }).then(({ error }) => {
      if (error) {
        // Queue for retry on next load (e.g. table migration not run yet).
        APP_STATE._pendingPaymentRetry = { client_id: String(clientId), invoice_key: mk, amount_due: amount, currency: CUR(), method, reference: ref || '', status: 'paid', pending_retry: true };
        return { ok: true, cloud: false, error };
      }
      APP_STATE.clientPaymentsCloudOk = true;
      return { ok: true, cloud: true };
    }).catch((e) => ({ ok: true, cloud: false, error: e }));
  }

  // Retry queued payments once the cloud table becomes available.
  async function flushPendingPaymentRetry() {
    const pend = APP_STATE && APP_STATE._pendingPaymentRetry;
    const sb = APP_STATE && APP_STATE.supabaseClient;
    if (!pend || !sb) return;
    try {
      const { error } = await sb.from('client_payments').insert(pend);
      if (!error) {
        APP_STATE._pendingPaymentRetry = null;
        console.info('💳 Queued payment synced to cloud.');
      }
    } catch (e) { /* keep queued for next time */ }
  }

  // ============================================================
  // PROVIDER CONFIG (js/config.js ← overridden by admin_config row)
  // ============================================================
  window.getPaymentProviderConfig = function () {
    const cfg = (window.APP_CONFIG && APP_CONFIG) || {};
    const ac = (APP_STATE && APP_STATE.adminConfig) || {};
    return {
      provider: String(ac.payment_provider || cfg.PAYMENT_PROVIDER || '').trim().toLowerCase(),
      stripePk: String(ac.stripe_publishable_key || cfg.STRIPE_PUBLISHABLE_KEY || '').trim(),
      appleMerchantId: String(ac.apple_pay_merchant_id || cfg.APPLE_PAY_MERCHANT_ID || '').trim()
    };
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  // ============================================================
  // APPLE PAY (direct, passkit.js.apple.com)
  // ============================================================
  async function canUseApplePayDirect() {
    const cfg = window.getPaymentProviderConfig();
    if (!cfg.appleMerchantId) return false;
    if (!(window.ApplePaySession && ApplePaySession.canMakePayments())) return false;
    try {
      await loadScript('https://cdn.apple-pay.cdn-apple.com/passkit.passkit.js.apple.com/latest/passkit.js');
      if (!window.ApplePayValidation || !ApplePayValidation.checkMerchant) return false;
      const ok = await new Promise((res) => {
        try {
          ApplePayValidation.checkMerchant(cfg.appleMerchantId,
            window.location.origin || undefined, (valid) => res(!!valid));
        } catch (e) { res(false); }
      });
      return !!ok;
    } catch (e) { return false; }
  }

  function startApplePayDirect(amount, label, onSuccess, onError) {
    try {
      const request = {
        countryCode: 'AE',
        currencyCode: CUR(),
        total: { label: label || 'TAS Personal Training', type: 'final', amount: amount.toFixed(2) },
        supportedNetworks: ['visa', 'masterCard', 'amex'],
        merchantCapabilities: ['supports3DS']
      };
      const session = new ApplePaySession(4, request);
      session.onvalidatemerchant = (event) => {
        ApplePayValidation.checkMerchant(window.getPaymentProviderConfig().appleMerchantId,
          event.validationURL, (ok) => {
            if (ok) session.completeMerchantValidation(ok);
            else { try { session.abort(); } catch (e) {} onError(new Error('Apple Pay merchant validation failed.')); }
          });
      };
      session.onpaymentauthorized = async (event) => {
        const token = JSON.stringify(event.payment.token || {});
        const ref = 'applepay:' + token.slice(0, 40);
        try {
          await onSuccess(ref);
          session.completePayment(ApplePaySession.STATUS_SUCCESS);
        } catch (e) {
          session.completePayment(ApplePaySession.STATUS_FAILURE);
          onError(e);
        }
      };
      session.oncancel = () => onError(new Error('cancelled'));
      session.begin();
    } catch (e) { onError(e); }
  }

  // ============================================================
  // STRIPE Payment Request (Apple Pay + Google Pay + Card buttons)
  // ============================================================
  let _stripePromise = null;
  async function getStripe() {
    const cfg = window.getPaymentProviderConfig();
    if (!cfg.stripePk) throw new Error('Stripe publishable key not configured.');
    await loadScript('https://js.stripe.com/v3/');
    if (!window.Stripe) throw new Error('Stripe SDK unavailable.');
    if (!_stripePromise) _stripePromise = window.Stripe(cfg.stripePk);
    return _stripePromise;
  }

  async function canUseStripeWallets() {
    const cfg = window.getPaymentProviderConfig();
    if (cfg.provider !== 'stripe' || !cfg.stripePk) return { pr: false, card: false };
    try {
      const stripe = await getStripe();
      const pr = stripe.paymentRequest({
        country: 'AE', currency: CUR().toLowerCase(), total: { label: 'TAS Training', amount: 100 },
        requestPayerName: true
      });
      const available = await pr.canMakePayment();
      return {
        pr: !!(available && (available.applePay || available.googlePay)),
        card: true,
        applePay: !!(available && available.applePay),
        googlePay: !!(available && available.googlePay)
      };
    } catch (e) { return { pr: false, card: false }; }
  }

  async function payWithStripe(method, amount, label, onSuccess, onError) {
    try {
      const stripe = await getStripe();
      if (method === 'card') {
        // Generic card option: modal card element, immediate payment intent style.
        const elements = stripe.elements({ mode: 'payment', amountInCents: Math.round(amount * 100), currency: CUR().toLowerCase() });
        const checkout = elements.create('payment');
        const wrap = document.createElement('div');
        wrap.className = 'modal-overlay tas-card-modal';
        wrap.innerHTML = `<div class="modal-card tas-card-modal-card">
            <div class="modal-title">💳 Pay with card</div>
            <p class="modal-subhead">${label}</p>
            <div id="tasCardElement" style="min-height:120px;padding:0.5rem 0;border:1px solid var(--line,#ddd);border-radius:10px;"></div>
            <div class="modal-actions"><button class="btn-secondary" id="tasCardCancel" type="button">Cancel</button>
            <button class="btn-primary" id="tasCardPay" type="button" style="width:auto;">Pay ${fmtMoney(amount)}</button></div>
          </div>`;
        document.body.appendChild(wrap);
        wrap.classList.remove('hidden');
        mount(() => checkout.mount('#tasCardElement'));
        const cleanup = () => { try { checkout.destroy(); } catch (e) {} wrap.remove(); };
        $id('tasCardCancel').onclick = () => { cleanup(); onError(new Error('cancelled')); };
        $id('tasCardPay').onclick = async () => {
          $id('tasCardPay').disabled = true;
          const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
          cleanup();
          if (error) onError(error);
          else onSuccess('card:' + ((paymentIntent && paymentIntent.id) || Date.now()));
        };
        return;
      }
      // Apple Pay / Google Pay via Payment Request button.
      const pr = stripe.paymentRequest({
        country: 'AE', currency: CUR().toLowerCase(),
        total: { label, amount: Math.round(amount * 100) },
        requestPayerName: true,
        ...(method === 'applePay' ? { disableWalletButtons: ['googlePay', 'link'] } : {}),
        ...(method === 'googlePay' ? { disableWalletButtons: ['applePay', 'link'] } : {})
      });
      const btnWrap = document.createElement('div');
      btnWrap.className = 'modal-overlay tas-card-modal';
      btnWrap.innerHTML = `<div class="modal-card tas-card-modal-card">
          <div class="modal-title">${method === 'applePay' ? '' : 'G'}Pay</div>
          <p class="modal-subhead">${label}</p>
          <div id="tasPrButton"></div>
          <div class="modal-actions"><button class="btn-secondary" id="tasPrCancel" type="button">Cancel</button></div>
        </div>`;
      document.body.appendChild(btnWrap);
      const prBtn = pr.button({ theme: method === 'applePay' ? 'black' : 'dark' });
      prBtn.mount('#tasPrButton');
      pr.on('token', async ({ complete3DSAuth }) => {
        const { error } = await stripe.confirmToken({
          payment_method: 'card',
          payment_method_data: { card: pr.paymentMethod },
          confirmation_token: pr.confirmationToken,
          redirect: 'if_required'
        });
        if (!error) { await complete3DSAuth(true); btnWrap.remove(); onSuccess(method + ':' + (pr.confirmationToken || Date.now())); }
        else { await complete3DSAuth(false); btnWrap.remove(); onError(error); }
      });
      $id('tasPrCancel').onclick = () => { btnWrap.remove(); onError(new Error('cancelled')); };
    } catch (e) { onError(e); }
  }

  function mount(fn) { requestAnimationFrame(fn); }

  // ============================================================
  // MASTER PAY FLOW — picks the best available option
  // ============================================================
  window.tasPayNow = async function (opts) {
    // opts: { clientId, monthKeys: [...], amount, label, methodHint }
    opts = opts || {};
    const S = window.APP_STATE;
    const c = opts.clientId != null ? getClientSafe(opts.clientId) : (S && S.loggedInClient);
    if (!c) { toast('🔐 Please sign in first to make a payment.', 'info'); return; }

    const amount = Number(opts.amount) || 0;
    if (amount <= 0) { toast('✅ You have nothing due — enjoy your training!', 'success'); renderAll(); return; }

    // Single canonical invoice key: "2026-08+2026-09+2026-10" (oldest→newest)
    // covers the carried-over months plus the current one in ONE paid row.
    const keys = (opts.monthKeys && opts.monthKeys.length) ? opts.monthKeys : [monthKeyOf(new Date().getFullYear(), new Date().getMonth())];
    const invoiceKey = keys.slice().sort().join('+');
    const label = opts.label || `TAS Personal Training — ${keys.map(monthLabel).join(', ')}`;
    const cfg = window.getPaymentProviderConfig();
    const busy = (on) => document.querySelectorAll('.pay-method-btn').forEach(b => { b.disabled = on; });

    const finalize = async (method, ref) => {
      busy(true);
      try {
        const res = await persistPayment(c.id, invoiceKey, method, amount, ref);
        if (!res.cloud) {
          toast('💾 Payment recorded — will sync to the cloud automatically. Thank you!', 'warning', 5000);
        } else {
          toast('✅ Payment successful! Your balance is cleared.', 'success', 4500);
        }
        renderAll();
        if (typeof window.refreshClientPortalViews === 'function') window.refreshClientPortalViews();
      } catch (e) {
        toast('❌ Could not save the payment: ' + e.message, 'error');
      } finally { busy(false); }
    };
    const fail = (err) => {
      busy(false);
      if (!err || String(err.message || err) === 'cancelled') { toast('ℹ️ Payment cancelled.', 'info'); return; }
      toast('❌ Payment failed: ' + (err.message || err), 'error', 5500);
    };

    busy(true);
    try {
      // 1 · Stripe configured → Apple Pay / Google Pay / Card via Stripe.
      if (cfg.provider === 'stripe' && cfg.stripePk) {
        busy(false);
        const hint = opts.methodHint;
        if (hint === 'card') return payWithStripe('card', amount, label, (ref) => finalize('card', ref), fail);
        return payWithStripe(hint === 'googlePay' ? 'googlePay' : 'applePay', amount, label,
          (ref) => finalize(hint === 'googlePay' ? 'google_pay' : 'apple_pay', ref), fail);
      }
      // 2 · Apple Pay Direct configured and device supports it.
      if ((cfg.provider === 'apple_pay_direct' || cfg.appleMerchantId) && await canUseApplePayDirect()) {
        busy(false);
        return startApplePayDirect(amount, label, (ref) => finalize('apple_pay', ref), fail);
      }
      // 3 · No PSP configured → offline/cash acknowledgement so the ledger
      //     still works (trainer verifies actual settlement separately).
      busy(false);
      const conf = (typeof window.uiConfirm === 'function')
        ? await window.uiConfirm({
            title: '💳 Confirm payment',
            message: `Record your payment of ${fmtMoney(amount)} for ${label}? This marks the balance as PAID in your portal. (Apple Pay / Google Pay / Card become available once the trainer connects a payment provider.)`,
            confirmText: '✅ I have paid', cancelText: 'Cancel'
          })
        : window.confirm(`Record payment of ${fmtMoney(amount)} for ${label}?`);
      if (conf) finalize('cash_or_transfer', 'manual:' + nowStamp());
      else toast('ℹ️ No payment recorded — your balance stays due.', 'info');
    } catch (e) { fail(e); }
  };

  function getClientSafe(id) {
    try { return (typeof getClient === 'function') ? getClient(id) : (APP_STATE.clients.find(x => sameId(x.id, id)) || null); }
    catch (e) { return null; }
  }
  function toast(msg, type, ms) {
    try { (typeof showToast === 'function') ? showToast(msg, type, ms) : console.info(msg); } catch (e) {}
  }

  // ============================================================
  // UI — inject the "💳 Pay For Your Sessions" card + wire buttons
  // ============================================================
  function ensureCardMounted() {
    if ($id('clientPaymentCard')) return $id('clientPaymentCard');
    const anchor = $id('clientUpcomingBlock');
    if (!anchor || !anchor.parentNode) return null;
    const div = document.createElement('div');
    div.className = 'section-card payment-section-card';
    div.id = 'clientPaymentCard';
    div.innerHTML = `
      <div class="payment-head">
        <span class="section-card-title" style="margin-bottom:0;">💳 Pay For Your Sessions</span>
        <span class="payment-badge" id="paymentStatusBadge">—</span>
      </div>
      <div class="section-card-hint">Your monthly amount is calculated from completed sessions × your session rate.
        Any month left unpaid automatically carries over and is added to next month's total.</div>
      <div class="payment-breakdown" id="paymentBreakdown"></div>
      <div class="payment-total-row" id="paymentTotalRow"></div>
      <div class="payment-methods" id="paymentMethods" role="group" aria-label="Payment methods"></div>
      <div class="payment-history-wrap">
        <div class="payment-history-title">🧾 Payment history</div>
        <div id="paymentHistoryList" class="payment-history-list"></div>
      </div>`;
    anchor.parentNode.insertBefore(div, anchor.nextSibling);
    bindPaymentEvents(div);
    return div;
  }

  function methodButtonHTML() {
    const cfg = window.getPaymentProviderConfig();
    const btns = [];
    if (cfg.provider === 'stripe' && cfg.stripePk) {
      btns.push(`<button class="pay-method-btn pay-apple" data-pay-method="applePay" type="button" hidden><span class="pm-logo"></span> Pay <span class="pm-with">Apple Pay</span></button>`);
      btns.push(`<button class="pay-method-btn pay-google" data-pay-method="googlePay" type="button" hidden><span class="pm-logo"></span> Pay with <b>G</b><span class="g-c1">o</span><span class="g-c2">o</span><span class="g-c3">g</span><span class="g-c4">l</span><span class="g-c5">e</span> Pay</button>`);
      btns.push(`<button class="pay-method-btn pay-card" data-pay-method="card" type="button" hidden>💳 Pay with Card</button>`);
    } else {
      btns.push(`<button class="pay-method-btn pay-apple" data-pay-method="applePay" type="button" hidden><span class="pm-logo"></span> Pay <span class="pm-with">Apple Pay</span></button>`);
    }
    btns.push(`<button class="pay-method-btn pay-offline" data-pay-method="offline" type="button">✔️ Record payment <span class="pm-note">(bank transfer / cash)</span></button>`);
    return btns.join('');
  }

  let _walletProbeDone = false;
  async function revealSupportedWallets() {
    if (_walletProbeDone) return;
    _walletProbeDone = true;
    const cfg = window.getPaymentProviderConfig();
    const appleBtn = document.querySelector('#paymentMethods .pay-apple');
    const gpayBtn = document.querySelector('#paymentMethods .pay-google');
    const cardBtn = document.querySelector('#paymentMethods .pay-card');
    try {
      if (cfg.provider === 'stripe' && cfg.stripePk) {
        const caps = await canUseStripeWallets();
        if (caps.pr) {
          if (caps.applePay && appleBtn) appleBtn.hidden = false;
          if (caps.googlePay && gpayBtn) gpayBtn.hidden = false;
        }
        if (caps.card && cardBtn) cardBtn.hidden = false;
        if (cardBtn) cardBtn.hidden = false; // card always works with Stripe
      } else if (await canUseApplePayDirect()) {
        if (appleBtn) appleBtn.hidden = false;
      }
    } catch (e) { /* keep buttons hidden */ }
  }

  function bindPaymentEvents(card) {
    // One delegated listener survives re-renders of the inner HTML.
    card.addEventListener('click', (ev) => {
      try {
        const btn = ev.target.closest('[data-pay-method]');
        if (!btn || btn.disabled) return;
        const c = APP_STATE && APP_STATE.loggedInClient;
        if (!c) { toast('🔐 Please sign in first.', 'info'); return; }
        const info = window.getBalanceInfo(c.id);
        const method = btn.dataset.payMethod;
        if (method === 'offline') {
          window.tasPayNow({ clientId: c.id, amount: info.totalDue, monthKeys: collectUnpaidKeys(info), methodHint: null });
        } else {
          window.tasPayNow({ clientId: c.id, amount: info.totalDue, monthKeys: collectUnpaidKeys(info), methodHint: method });
        }
      } catch (e) { console.error('payment click:', e); }
    });
  }

  function collectUnpaidKeys(info) {
    const keys = (info.carryMonths || []).map(m => m.key);
    const nowD = new Date();
    const curKey = monthKeyOf(nowD.getFullYear(), nowD.getMonth());
    if (info.monthDue > 0 && !info.thisMonthPaid) keys.push(curKey);
    return keys;
  }

  // Render breakdown, total, badge and history for the logged-in client.
  window.renderPaymentCard = function (c) {
    c = c || (APP_STATE && APP_STATE.loggedInClient);
    const card = ensureCardMounted();
    if (!card) return;
    if (!c) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');

    const info = window.getBalanceInfo(c.id);
    const badge = $id('paymentStatusBadge');
    const breakdown = $id('paymentBreakdown');
    const totalRow = $id('paymentTotalRow');
    const methods = $id('paymentMethods');
    const hist = $id('paymentHistoryList');

    if (badge) {
      badge.textContent = info.allClear ? '✅ Paid up to date' : '⏳ Payment due';
      badge.className = 'payment-badge ' + (info.allClear ? 'paid' : 'due');
    }

    if (breakdown) {
      const nowD = new Date();
      const curKey = monthKeyOf(nowD.getFullYear(), nowD.getMonth());
      let html = `<div class="payment-line"><span>📆 ${monthLabel(curKey)} — ${info.sessions} session${info.sessions === 1 ? '' : 'es'} × ${fmtMoney(info.rate)}</span><strong>${fmtMoney(info.monthDue)}</strong></div>`;
      if (info.carryMonths.length) {
        html += `<div class="payment-carry-title">📌 Carried over from previous months</div>`;
        html += info.carryMonths.map(m =>
          `<div class="payment-line carry"><span>${m.label} — ${m.sessions} session${m.sessions === 1 ? '' : 'es'}</span><strong>${fmtMoney(m.amount)}</strong></div>`).join('');
      }
      breakdown.innerHTML = html;
    }

    if (totalRow) {
      totalRow.innerHTML = info.allClear
        ? `<span>Total due</span><strong class="zero">${CUR()} 0 — all clear 🎉</strong>`
        : `<span>Total due now</span><strong class="due">${fmtMoney(info.totalDue)}</strong>`;
    }

    if (methods) {
      if (methods.dataset.bound !== 'yes') { methods.innerHTML = methodButtonHTML(); methods.dataset.bound = 'yes'; }
      const offBtn = methods.querySelector('.pay-offline');
      if (offBtn) {
        offBtn.disabled = info.allClear;
        if (info.allClear) offBtn.innerHTML = '✅ Nothing due — thank you!';
        else offBtn.innerHTML = `✔️ Record payment <span class="pm-note">${fmtMoney(info.totalDue)}</span>`;
      }
      methods.querySelectorAll('[data-pay-method^="apple"],[data-pay-method="googlePay"],[data-pay-method="card"]')
        .forEach(b => { b.disabled = info.allClear; });
    }
    revealSupportedWallets();

    // Update the headline tile: total DUE (with carry-over), not just this month.
    const tile = $id('clientDashAmount');
    if (tile) tile.textContent = `${CUR()} ${(info.totalDue || 0).toLocaleString('en-US')}`;

    // Payment history (cloud rows + local mirror, newest first).
    if (hist) {
      const remote = ((APP_STATE.clientPayments) || []).filter(p => sameId(p.client_id, c.id));
      const local = readLocalPayments().filter(p => String(p.client_id) === String(c.id));
      const seen = {};
      const all = remote.concat(local).filter(p => {
        const k = p.invoice_key + '|' + (p.created_at || '');
        if (seen[k]) return false; seen[k] = 1; return true;
      }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 12);
      hist.innerHTML = all.length
        ? all.map(p => `<div class="payment-history-row">
            <span class="ph-when">${monthLabel(p.invoice_key)}</span>
            <span class="ph-method">${methodLabel(p.method)}</span>
            <span class="ph-amt">${fmtMoney(p.amount_due)}</span>
            <span class="ph-status paid">PAID</span></div>`).join('')
        : `<div class="payment-history-empty">No payments yet — your statement appears above.</div>`;
    }
  };

  function methodLabel(m) {
    switch (String(m || '')) {
      case 'apple_pay': return ' Pay';
      case 'google_pay': return 'G Pay';
      case 'card': return '💳 Card';
      default: return '🏦 Transfer/Cash';
    }
  }

  function renderAll() {
    try {
      const c = APP_STATE && APP_STATE.loggedInClient;
      if (c) window.renderPaymentCard(c);
    } catch (e) { console.warn('renderPaymentCard:', e); }
  }

  // Re-render after every global data load / login (defensive wrappers —
  // never break the existing pipeline if those functions change shape).
  function hookRerenders() {
    const wrap = (obj, name) => {
      const orig = obj[name];
      if (typeof orig !== 'function' || orig.__payHooked) return;
      obj[name] = function () {
        const args = arguments, self = this;
        const out = orig.apply(self, args);
        Promise.resolve(out).then(() => { try { renderAll(); } catch (e) {} }).catch(() => {});
        return out;
      };
      obj[name].__payHooked = true;
    };
    try { wrap(window, 'renderClientDashboard'); } catch (e) {}
    try { wrap(window, 'loadAllData'); } catch (e) {}
  }

  // ============================================================
  // BOOT
  // ============================================================
  function boot() {
    hookRerenders();
    // Load cloud payments ASAP (before/parallel with the rest of the app).
    (async function () {
      try {
        let tries = 0;
        while (!APP_STATE || !APP_STATE.supabaseClient && tries < 50) { await new Promise(r => setTimeout(r, 200)); tries++; }
        await window.loadClientPayments();
        await flushPendingPaymentRetry();
        renderAll();
      } catch (e) { /* offline — localStorage mirror still powers the flow */ }
    })();
    // Safety net: if the dashboard rendered before this script booted.
    document.addEventListener('DOMContentLoaded', () => setTimeout(renderAll, 300));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
