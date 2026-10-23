// ============================================================
// 💳 PAYMENTS — client-portal payment options + outstanding balance
// ------------------------------------------------------------
// WHAT THIS FILE DOES
//   • Shows the amount due for the current month's sessions inside
//     the client portal ("💵 Amount due" tile + a dedicated
//     "💳 Pay For Your Sessions" card with a monthly statement).
//   • Payment methods are DIRECT-TO-COACH ONLY — no paid gateway,
//     no API keys anywhere:
//       🏦 Bank Transfer → money lands straight in the trainer's bank account
//       🅿️ PayPal.me     → money lands straight in the trainer's PayPal.
//         Clients in ANY country can pay from inside PayPal using their
//         linked Visa/Mastercard, Apple Pay or Samsung Pay — 100% free for
//         personal accounts (peer-to-peer, same currency). No keys needed.
//       ✔️ Record payment (cash / plain transfer) fallback if neither is set up.
//     Declared transfers are stored as 'pending' and only clear the balance
//     once the trainer approves them from the admin "💳 Incoming Payments" panel.
//   • The amount due is ONLY cleared once a payment completes
//     successfully (paid invoice rows in Supabase `client_payments`,
//     mirrored to localStorage while offline). Unpaid months are not
//     forgotten: their balance automatically CARRIES OVER and is added
//     to the next month's due amount until it is paid.
//
// BACKEND SETUP (one-time, safe & idempotent):
//   Run sql/client_payments.sql once in Supabase → SQL Editor. It
//   creates the `client_payments` table (+ RLS policies) and adds the
//   bank/PayPal detail columns to `admin_config`. Until that migration
//   exists everything degrades gracefully to localStorage, so the
//   portal never breaks.
//
// YOUR DETAILS (no keys needed):
//   In js/config.js set BANK_NAME / BANK_ACCOUNT_NAME / BANK_IBAN /
//   BANK_SWIFT / BANK_UPI_ID and/or PAYPAL_ME_LINK — or edit them live
//   from the admin "💳 Incoming Payments" panel (cloud values win).
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
  // NOTE: only rows with status 'paid' clear the balance. Bank-transfer
  // declarations are stored as 'pending' and do NOT clear the amount due —
  // it keeps carrying over until the trainer verifies the money landed in
  // their account and approves the payment (which flips the row to 'paid').
  function isInvoicePaid(clientId, mk) {
    const covers = (p) => String(p.invoice_key || '').split('+').indexOf(mk) !== -1;
    const remote = (window.APP_STATE && APP_STATE.clientPayments) || [];
    if (remote.some(p => sameId(p.client_id, clientId) && covers(p) &&
      String(p.status || 'paid') === 'paid')) return true;
    return readLocalPayments().some(p => String(p.client_id) === String(clientId) &&
      covers(p) && String(p.status || 'paid') === 'paid');
  }

  // Pending bank-transfer declarations for a client (for the "awaiting
  // verification" note in the portal).
  function getPendingTransfers(clientId) {
    const remote = ((window.APP_STATE && window.APP_STATE.clientPayments) || [])
      .filter(p => sameId(p.client_id, clientId) && String(p.status) === 'pending');
    const local = readLocalPayments()
      .filter(p => String(p.client_id) === String(clientId) && String(p.status) === 'pending');
    const seen = {};
    return remote.concat(local).filter(p => {
      const k = p.invoice_key + '|' + (p.created_at || '');
      if (seen[k]) return false; seen[k] = 1; return true;
    });
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
    return recordRowLocally(clientId, mk, method, amount, ref, 'paid');
  }
  function recordRowLocally(clientId, mk, method, amount, ref, status) {
    const rec = {
      client_id: String(clientId), invoice_key: mk, amount_due: amount,
      currency: CUR(), method, reference: ref || '', status,
      created_at: new Date().toISOString()
    };
    addLocalPayment(rec);
    if (APP_STATE.clientPayments) {
      if (!APP_STATE.clientPayments.some(p => sameId(p.client_id, clientId) && p.invoice_key === mk && p.status === status)) {
        APP_STATE.clientPayments.unshift(rec);
      }
    }
    return rec;
  }

  // Persist a completed payment. Cloud first; on failure fall back to the
  // local mirror and queue for retry so the balance still clears.
  function persistPayment(clientId, mk, method, amount, ref, status) {
    status = status || 'paid';
    const rec = recordRowLocally(clientId, mk, method, amount, ref, status);
    const sb = APP_STATE.supabaseClient;
    if (!sb) return Promise.resolve({ ok: true, cloud: false });
    return sb.from('client_payments').insert({
      client_id: String(clientId), invoice_key: mk, amount_due: amount,
      currency: CUR(), method, reference: ref || '', status
    }).then(({ error }) => {
      if (error) {
        // Queue for retry on next load (e.g. table migration not run yet).
        APP_STATE._pendingPaymentRetry = APP_STATE._pendingPaymentRetry || [];
        APP_STATE._pendingPaymentRetry.push(Object.assign({}, rec, { id: undefined, pending_retry: true }));
        return { ok: true, cloud: false, error };
      }
      APP_STATE.clientPaymentsCloudOk = true;
      return { ok: true, cloud: true };
    }).catch((e) => ({ ok: true, cloud: false, error: e }));
  }

  // Retry queued payments once the cloud table becomes available.
  async function flushPendingPaymentRetry() {
    const pend = (APP_STATE && APP_STATE._pendingPaymentRetry) || [];
    const sb = APP_STATE && APP_STATE.supabaseClient;
    if (!pend.length || !sb) return;
    const remaining = [];
    for (const row of pend) {
      try {
        const { error } = await sb.from('client_payments').insert(row);
        if (error) remaining.push(row);
      } catch (e) { remaining.push(row); }
    }
    APP_STATE._pendingPaymentRetry = remaining;
    if (pend.length && !remaining.length) console.info('💳 Queued payments synced to cloud.');
  }

  // ============================================================
  // PROVIDER CONFIG (js/config.js ← overridden by admin_config row)
  // ============================================================
  window.getPaymentProviderConfig = function () {
    const cfg = (window.APP_CONFIG && APP_CONFIG) || {};
    const ac = (APP_STATE && APP_STATE.adminConfig) || {};
    return {
      // 🏦 Direct-to-trainer bank transfer — money goes straight into the
      // trainer's own account. No gateway, no keys. Cloud (admin_config)
      // values override js/config.js so the trainer can edit them live.
      bankEnabled: (ac.bank_transfer_enabled != null ? ac.bank_transfer_enabled !== false && ac.bank_transfer_enabled !== 'false' : cfg.BANK_TRANSFER_ENABLED !== false),
      bankName: String(ac.bank_name || cfg.BANK_NAME || '').trim(),
      bankAccountName: String(ac.bank_account_name || cfg.BANK_ACCOUNT_NAME || '').trim(),
      bankIban: String(ac.bank_iban || cfg.BANK_IBAN || '').trim(),
      bankSwift: String(ac.bank_swift || cfg.BANK_SWIFT || '').trim(),
      bankUpi: String(ac.bank_upi_id || cfg.BANK_UPI_ID || '').trim(),
      paypalLink: String(ac.paypal_me_link || cfg.PAYPAL_ME_LINK || '').trim()
    };
  };

  function hasBankDetails(b) {
    return !!(b.bankEnabled && (b.bankIban || b.bankUpi || b.bankName));
  }

  // ============================================================
  // 🏦 DIRECT BANK TRANSFER — money goes straight to the trainer's account
  // ============================================================
  // Shows the trainer's bank details + the exact amount due, with copy &
  // WhatsApp buttons. When the client ticks "I have transferred", a
  // 'pending' row is stored (cloud + local). The amount due does NOT clear
  // yet — it stays due (and keeps carrying over) until the trainer checks
  // their bank and approves the payment from the admin Payments panel.
  window.tasShowBankTransferModal = function (opts) {
    const cfg = window.getPaymentProviderConfig();
    const amount = Number(opts.amount) || 0;
    const rows = [];
    if (cfg.bankName) rows.push(['🏦 Bank', cfg.bankName]);
    if (cfg.bankAccountName) rows.push(['👤 Account name', cfg.bankAccountName]);
    if (cfg.bankIban) rows.push(['🔢 IBAN', cfg.bankIban]);
    if (cfg.bankSwift) rows.push(['🌐 SWIFT/BIC', cfg.bankSwift]);
    if (cfg.bankUpi) rows.push(['📱 UPI ID', cfg.bankUpi]);
    // If the coach hasn't saved bank details yet, still give the client a
    // usable sheet: pay from their own banking app to the coach and declare.
    if (!rows.length) {
      rows.push(['ℹ️ How to pay', "Open your banking app and send the exact amount below directly to your coach's account, then tap \"I have transferred\" here so they can verify and clear your balance."]);
    }
    const esc = (s) => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-overlay tas-card-modal';
      wrap.innerHTML = `<div class="modal-card tas-card-modal-card">
        <div class="modal-title">🏦 Direct bank transfer</div>
        <p class="modal-subhead">Transfer <strong>${esc(fmtMoney(amount))}</strong> straight into the trainer's account using the details below, then tap "I have transferred". Your coach verifies the payment and your balance clears right after.</p>
        <div class="bank-details" style="border:1px solid var(--line,#ddd);border-radius:12px;padding:.6rem .8rem;margin:.4rem 0;display:flex;flex-direction:column;gap:.35rem;">
          ${rows.map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:.6rem;align-items:center;"><span style="opacity:.75;">${esc(k)}</span><strong style="user-select:all;text-align:right;word-break:break-all;" data-bank-val="${esc(v)}">${esc(v)}</strong></div>`).join('')}
          <div style="display:flex;justify-content:space-between;gap:.6rem;align-items:center;"><span style="opacity:.75;">💵 Amount</span><strong data-bank-val="${amount.toFixed(2)}">${fmtMoney(amount)}</strong></div>
        </div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.2rem;">
          <button class="btn-secondary" id="tasBankCopy" type="button" style="width:auto;">📋 Copy details</button>
          <a class="btn-secondary" id="tasBankWa" type="button" style="width:auto;text-decoration:none;display:inline-flex;align-items:center;">📲 Send receipt on WhatsApp</a>
        </div>
        <label style="display:flex;gap:.5rem;align-items:flex-start;margin-top:.8rem;font-size:.92rem;">
          <input type="checkbox" id="tasBankDone" style="margin-top:.25rem;" />
          <span>I have transferred <strong>${fmtMoney(amount)}</strong> to this account.</span>
        </label>
        <div class="modal-actions">
          <button class="btn-secondary" id="tasBankCancel" type="button">Cancel</button>
          <button class="btn-primary" id="tasBankDeclare" type="button" style="width:auto;" disabled>✅ I have paid — notify my coach</button>
        </div>
        <p style="font-size:.8rem;opacity:.7;margin:.4rem 0 0;">⚠️ Until your coach confirms the money arrived, the amount stays due and carries over to next month automatically.</p>
      </div>`;
      document.body.appendChild(wrap);

      const waText = `Hi Coach, I have transferred ${fmtMoney(amount)} (${opts.label || ''}) to your account.`;
      const waNum = (window.APP_CONFIG && APP_CONFIG.TRAINER_WHATSAPP) || '';
      const waLink = $id('tasBankWa');
      waLink.href = waNum ? `https://wa.me/${String(waNum).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(waText)}` : '#';
      if (!waNum) waLink.style.display = 'none';

      $id('tasBankCopy').onclick = () => {
        const txt = rows.map(([k, v]) => `${k.replace(/^\S+\s/, '')}: ${v}`).join('\n') + `\nAmount: ${amount.toFixed(2)} ${CUR()}`;
        try { navigator.clipboard.writeText(txt); toast('📋 Bank details copied.', 'success'); }
        catch (e) { toast('Long-press the values to copy them.', 'info'); }
      };
      const done = $id('tasBankDone');
      done.onchange = () => { $id('tasBankDeclare').disabled = !done.checked; };
      $id('tasBankCancel').onclick = () => { wrap.remove(); resolve(false); };
      $id('tasBankDeclare').onclick = async () => {
        $id('tasBankDeclare').disabled = true;
        try { await opts.onDeclared(done.checked); } catch (e) {}
        wrap.remove();
        resolve(true);
      };
    });
  };

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
      // 1 · 🏦 Direct bank transfer to the trainer's OWN account — no gateway,
      //     no keys. Money lands straight in the trainer's bank; the client
      //     declares the transfer (status 'pending') and the balance only
      //     clears once the trainer approves it in the Payments panel.
      if (hasBankDetails(cfg)) {
        busy(false);
        await window.tasShowBankTransferModal({
          amount, label,
          onDeclared: async () => {
            const res = await persistPayment(c.id, invoiceKey, 'bank_transfer', amount,
              'declared:' + nowStamp(), 'pending');
            toast('🏦 Transfer noted! Your coach will confirm receipt — until then the amount stays due.', res.cloud ? 'success' : 'warning', 6000);
            renderAll();
            if (typeof window.refreshClientPortalViews === 'function') window.refreshClientPortalViews();
          }
        });
        return;
      }
      // 2 · No bank details configured yet → offline/cash acknowledgement so
      //     the ledger still works (trainer verifies actual settlement separately).
      busy(false);
      const conf = (typeof window.uiConfirm === 'function')
        ? await window.uiConfirm({
            title: '💳 Confirm payment',
            message: `Record your payment of ${fmtMoney(amount)} for ${label}? Your coach will verify the money arrived before the balance is fully cleared.`,
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
    // 🏦 Direct transfer into the trainer's own bank account (no gateway).
    // Shown even before details are saved so clients know the option exists;
    // tapping it without details opens a "send via your banking app" sheet.
    if (cfg.bankEnabled !== false) {
      btns.push(`<button class="pay-method-btn pay-bank" data-pay-method="bank" type="button">🏦 Bank Transfer <span class="pm-note">(direct to coach's account)</span></button>`);
    }
    // PayPal.me — pays straight into the trainer's PayPal wallet. Clients in
    // any country can tap this and pay with their linked Visa/Mastercard,
    // Apple Pay or Samsung Pay inside PayPal — 100% free for personal
    // accounts, money lands directly in the coach's PayPal. No API keys.
    if (cfg.paypalLink) {
      btns.push(`<button class="pay-method-btn pay-paypal" data-pay-method="paypal" type="button">🅿️ PayPal <span class="pm-note">(cards · Apple Pay · Samsung Pay — direct to coach)</span></button>`);
    }
    if (!hasBankDetails(cfg) && !cfg.paypalLink) {
      btns.push(`<button class="pay-method-btn pay-offline" data-pay-method="offline" type="button">✔️ Record payment <span class="pm-note">(bank transfer / cash)</span></button>`);
    }
    return btns.join('');
  }

  async function declarePaidViaExternal(methodKey, cloudMethod, c, info, link) {
    const amount = info.totalDue;
    if (amount <= 0) { toast('✅ You have nothing due — enjoy your training!', 'success'); return; }
    if (!link) { toast('⚠️ The coach has not set up a PayPal.me link yet.', 'warning'); return; }
    const keys = collectUnpaidKeys(info);
    const invoiceKey = keys.slice().sort().join('+');
    const label = `TAS Personal Training — ${keys.map(monthLabel).join(', ')}`;
    // Open the direct payment destination in a new tab (pop-up blockers:
    // triggered from a user click so window.open is allowed).
    try { window.open(link + encodeURIComponent(String(amount)), '_blank', 'noopener'); } catch (e) {}
    const conf = (typeof window.uiConfirm === 'function')
      ? await window.uiConfirm({
          title: '🅿️ Confirm PayPal payment',
          message: `In the PayPal page that just opened, pay with your linked Visa/Mastercard, Apple Pay or Samsung Pay (all free for personal accounts — money goes straight to your coach). Have you completed the payment of ${fmtMoney(amount)} (${label})? Your balance clears once your coach confirms receipt.`,
          confirmText: '✅ I have paid', cancelText: 'Not yet'
        })
      : window.confirm(`Have you completed the PayPal payment of ${fmtMoney(amount)} using your card / Apple Pay / Samsung Pay?`);
    if (!conf) { toast('ℹ️ No payment recorded — your balance stays due.', 'info'); return; }
    const res = await persistPayment(c.id, invoiceKey, cloudMethod, amount, 'declared:' + nowStamp(), 'pending');
    toast('💶 Payment noted! Your coach will confirm receipt — until then the amount stays due.', res.cloud ? 'success' : 'warning', 6000);
    renderAll();
    if (typeof window.refreshClientPortalViews === 'function') window.refreshClientPortalViews();
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
        } else if (method === 'bank') {
          if (info.allClear) { toast('✅ Nothing due — enjoy your training!', 'success'); return; }
          window.tasShowBankTransferModal({
            amount: info.totalDue,
            label: `TAS Personal Training — ${collectUnpaidKeys(info).map(monthLabel).join(', ')}`,
            onDeclared: async () => {
              const keys = collectUnpaidKeys(info);
              const res = await persistPayment(c.id, keys.slice().sort().join('+'), 'bank_transfer', info.totalDue, 'declared:' + nowStamp(), 'pending');
              toast('🏦 Transfer noted! Your coach will confirm receipt — until then the amount stays due.', res.cloud ? 'success' : 'warning', 6000);
              renderAll();
            }
          });
        } else if (method === 'paypal') {
          const cfgP = window.getPaymentProviderConfig();
          declarePaidViaExternal('paypal', 'paypal', c, info, cfgP.paypalLink);
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
      const bankBtn = methods.querySelector('.pay-bank');
      if (bankBtn) {
        bankBtn.disabled = info.allClear;
        if (info.allClear) bankBtn.innerHTML = '✅ Nothing due — thank you!';
        else bankBtn.innerHTML = `🏦 Bank Transfer <span class="pm-note">${fmtMoney(info.totalDue)} direct to coach</span>`;
      }
      const ppBtn = methods.querySelector('.pay-paypal');
      if (ppBtn) {
        ppBtn.disabled = info.allClear;
        if (info.allClear) ppBtn.innerHTML = '✅ Nothing due — thank you!';
        else ppBtn.innerHTML = `🅿️ PayPal <span class="pm-note">${fmtMoney(info.totalDue)}</span>`;
      }
    }

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
        ? all.map(p => {
            const st = String(p.status || 'paid');
            return `<div class="payment-history-row">
            <span class="ph-when">${monthLabel(p.invoice_key)}</span>
            <span class="ph-method">${methodLabel(p.method)}</span>
            <span class="ph-amt">${fmtMoney(p.amount_due)}</span>
            <span class="ph-status ${st === 'paid' ? 'paid' : 'pending'}"${st !== 'paid' ? ' style="color:#b7791f;"' : ''}>${st === 'paid' ? 'PAID' : (st === 'rejected' ? 'NOT RECEIVED' : 'PENDING')}</span></div>`;
          }).join('')
        : `<div class="payment-history-empty">No payments yet — your statement appears above.</div>`;
    }

    // Pending-transfer note (declared but awaiting coach verification).
    if (breakdown && !info.allClear) {
      const pend = getPendingTransfers(c.id);
      if (pend.length) {
        breakdown.insertAdjacentHTML('beforeend',
          `<div class="payment-pending-note" style="font-size:.85rem;opacity:.8;margin-top:.3rem;">⏳ Awaiting coach verification: ${pend.map(p => fmtMoney(p.amount_due)).join(', ')} — your balance clears as soon as your coach confirms the money arrived.</div>`);
      }
    }
  };

  // ============================================================
  // 🛠 ADMIN — verify & approve declared transfers + bank details
  // ------------------------------------------------------------
  // Floating panel on the ADMIN dashboard only. The trainer checks their
  // real bank account, taps "✅ Money received" and the client's amount
  // due clears instantly (row flips to 'paid'). "❌ Not received" keeps
  // the balance due so it carries over next month. Bank/PayPal details
  // are editable here and stored in admin_config (cloud) so every client
  // portal shows them without redeploying.
  // ============================================================
  function isAdminSession() {
    try {
      const sess = (typeof window.tasLoadSession === 'function') ? window.tasLoadSession() : null;
      return (sess && sess.role === 'admin') || !!document.getElementById('adminDashboard');
    } catch (e) { return false; }
  }

  function ensureAdminPaymentPanel() {
    let panel = document.getElementById('adminPaymentPanelFab');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'adminPaymentPanelFab';
      panel.style.cssText = 'position:fixed;right:14px;bottom:86px;z-index:1200;max-width:min(420px,calc(100vw - 28px));max-height:70vh;overflow:auto;background:var(--card,#fff);border:1px solid var(--line,#ddd);border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:.9rem 1rem;';
      document.body.appendChild(panel);
    }
    return panel;
  }

  window.renderAdminPaymentPanel = function () {
    const panel = ensureAdminPaymentPanel();
    const show = APP_STATE && isAdminSession();
    panel.style.display = show ? '' : 'none';
    if (!show) return;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const nameOf = (cid) => { try { const cl = getClientSafe(cid); return cl ? (cl.name || cl.id) : String(cid); } catch (e) { return String(cid); } };
    const cfg = window.getPaymentProviderConfig();
    const pending = (APP_STATE.clientPayments || [])
      .concat(readLocalPayments())
      .filter(p => String(p.status) === 'pending');
    // Deduplicate declarations (same client+invoice+timestamp)
    const seenKeys = {};
    const rows = pending.filter(p => {
      const k = `${p.client_id}|${p.invoice_key}|${p.created_at || ''}`;
      if (seenKeys[k]) return false; seenKeys[k] = 1; return true;
    });

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;">
        <strong>💳 Incoming Payments</strong>
        <button class="btn-secondary btn-small" id="apToggleBody" type="button" style="width:auto;">${rows.length ? `🔔 ${rows.length} pending` : '⚙️ Settings'}</button>
      </div>
      <div id="apBody" class="hidden" style="margin-top:.6rem;display:flex;flex-direction:column;gap:.5rem;">
        <div style="font-size:.8rem;opacity:.75;">Verify money actually landed in YOUR bank/PayPal, then approve. Only approved payments clear a client's amount due; rejected ones stay due and carry over.</div>
        <div id="adminPendingList" style="display:flex;flex-direction:column;gap:.5rem;"></div>
        <details style="margin-top:.3rem;">
          <summary style="cursor:pointer;font-weight:600;">⚙️ Bank / PayPal details shown to clients</summary>
          <div style="display:grid;gap:.5rem;margin-top:.6rem;">
            <input class="input" id="apBankName" placeholder="Bank name" value="${esc(cfg.bankName)}" />
            <input class="input" id="apBankAcctName" placeholder="Account holder name" value="${esc(cfg.bankAccountName)}" />
            <input class="input" id="apBankIban" placeholder="IBAN" value="${esc(cfg.bankIban)}" />
            <input class="input" id="apBankSwift" placeholder="SWIFT/BIC (optional)" value="${esc(cfg.bankSwift)}" />
            <input class="input" id="apBankUpi" placeholder="UPI ID (optional)" value="${esc(cfg.bankUpi)}" />
            <input class="input" id="apPaypal" placeholder="PayPal.me link — clients can pay with Visa/Mastercard, Apple Pay or Samsung Pay (free, direct to you). e.g. https://paypal.me/yourhandle" value="${esc(cfg.paypalLink)}" />
            <button class="btn-primary" id="apSaveBank" type="button" style="width:auto;">💾 Save payment details</button>
          </div>
        </details>
      </div>`;

    const body = panel.querySelector('#apBody');
    if (rows.length) body.classList.remove('hidden');
    panel.querySelector('#apToggleBody').onclick = () => body.classList.toggle('hidden');

    const list = panel.querySelector('#adminPendingList');
    list.innerHTML = rows.length
      ? rows.map(p => `
        <div style="border:1px solid var(--line,#ddd);border-radius:12px;padding:.55rem .7rem;">
          <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:center;flex-wrap:wrap;">
            <strong>${esc(nameOf(p.client_id))}</strong>
            <span>${esc(fmtMoney(p.amount_due))}</span>
          </div>
          <div style="font-size:.78rem;opacity:.7;margin:.15rem 0 .4rem;">${esc(monthLabel(String(p.invoice_key || '').split('+').slice(-1)[0]))}${String(p.invoice_key || '').includes('+') ? ' (+ carried months)' : ''} · ${esc(methodLabel(p.method))} · ${esc(p.created_at ? new Date(p.created_at).toLocaleString() : '')}</div>
          <div style="display:flex;gap:.4rem;">
            <button class="btn-secondary btn-small" data-reject-pay="${esc(p.id || '')}" data-lc-client="${esc(p.client_id)}" data-lc-key="${esc(p.invoice_key)}" type="button" style="width:auto;">❌ Not received</button>
            <button class="btn-primary btn-small" data-approve-pay="${esc(p.id || '')}" data-lc-client="${esc(p.client_id)}" data-lc-key="${esc(p.invoice_key)}" type="button" style="width:auto;">✅ Money received</button>
          </div>
        </div>`).join('')
      : `<div style="opacity:.7;">✅ No transfers awaiting verification.</div>`;

    panel.onclick = async (ev) => {
      const ap = ev.target.closest('[data-approve-pay]');
      const rj = ev.target.closest('[data-reject-pay]');
      if (ap) { await settleTransfer(ap.dataset.approvePay, ap.dataset.lcClient, ap.dataset.lcKey, 'paid', Number((ap.closest('div').querySelector('span') || {}).textContent) || 0); }
      else if (rj) { await settleTransfer(rj.dataset.rejectPay, rj.dataset.lcClient, rj.dataset.lcKey, 'rejected'); }
      else if (ev.target.closest('#apSaveBank')) {
        const ac = APP_STATE.adminConfig || (APP_STATE.adminConfig = {});
        ac.bank_name = $id('apBankName').value.trim();
        ac.bank_account_name = $id('apBankAcctName').value.trim();
        ac.bank_iban = $id('apBankIban').value.trim();
        ac.bank_swift = $id('apBankSwift').value.trim();
        ac.bank_upi_id = $id('apBankUpi').value.trim();
        ac.paypal_me_link = $id('apPaypal').value.trim();
        const sb = APP_STATE.supabaseClient;
        if (sb) {
          try {
            const { error } = await sb.from('admin_config').update({
              bank_name: ac.bank_name, bank_account_name: ac.bank_account_name,
              bank_iban: ac.bank_iban, bank_swift: ac.bank_swift,
              bank_upi_id: ac.bank_upi_id, paypal_me_link: ac.paypal_me_link
            }).eq('id', 1);
            if (error) throw error;
            toast('💾 Payment details saved — all client portals now show them.', 'success');
          } catch (e) {
            toast('💾 Saved on this device. Run sql/client_payments.sql once in Supabase to store these in the cloud for everyone.', 'warning', 6500);
          }
        } else toast('💾 Saved on this device (offline).', 'warning');
        renderAll();
      }
    };
  };

  // Approve/reject a pending declaration: update the cloud row when it has
  // an id; always flip the mirrored localStorage/in-memory rows too.
  async function settleTransfer(rowId, clientId, invoiceKey, newStatus, amount) {
    const sb = APP_STATE.supabaseClient;
    let cloudDone = false;
    if (sb && rowId) {
      try {
        const { error } = await sb.from('client_payments').update({ status: newStatus }).eq('id', rowId);
        cloudDone = !error;
        if (error) toast('⚠️ Cloud update failed: ' + error.message, 'error');
      } catch (e) { toast('⚠️ Cloud update failed: ' + e.message, 'error'); }
    }
    const loc = readLocalPayments();
    let touched = false;
    loc.forEach(p => {
      if (String(p.client_id) === String(clientId) && p.invoice_key === invoiceKey && String(p.status) === 'pending') {
        p.status = newStatus; touched = true;
      }
    });
    if (touched) writeLocalPayments(loc);
    (APP_STATE.clientPayments || []).forEach(p => {
      if ((rowId && String(p.id) === String(rowId)) ||
          (sameId(p.client_id, clientId) && p.invoice_key === invoiceKey && String(p.status) === 'pending')) {
        p.status = newStatus;
      }
    });
    if (!cloudDone && sb && newStatus === 'paid') {
      // Declaration was made offline (localStorage only) — push a paid row now.
      try {
        await sb.from('client_payments').insert({
          client_id: String(clientId), invoice_key: invoiceKey, amount_due: amount || 0,
          currency: CUR(), method: 'bank_transfer', reference: 'approved-offline-declaration', status: 'paid'
        });
      } catch (e) {}
    }
    toast(newStatus === 'paid'
      ? '✅ Approved — the client\'s balance is cleared.'
      : '❌ Marked as not received — the amount stays due and carries over.', newStatus === 'paid' ? 'success' : 'info', 5000);
    window.renderAdminPaymentPanel();
    renderAll();
  }

  function methodLabel(m) {
    switch (String(m || '')) {
      case 'bank_transfer': return '🏦 Bank Transfer';
      case 'paypal': return '🅿️ PayPal (card / Apple Pay / Samsung Pay)';
      default: return '🏦 Transfer/Cash';
    }
  }

  function renderAll() {
    try {
      const c = APP_STATE && APP_STATE.loggedInClient;
      if (c) window.renderPaymentCard(c);
    } catch (e) { console.warn('renderPaymentCard:', e); }
    try { window.renderAdminPaymentPanel(); } catch (e) {}
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
    try { wrap(window, 'openAdminDashboard'); } catch (e) {}
    try { wrap(window, 'renderHomeStats'); } catch (e) {}
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
