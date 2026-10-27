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

  // ---- payment cut-off stamping (🆕 post-payment sessions) ---------------
  // When an invoice is settled we store the exact settlement moment on the
  // paid row (`paid_at`). The balance engine then only counts sessions whose
  // own check-in happened AFTER that stamp for a paid month — so once a
  // payment clears, any NEW session created after it immediately shows up as
  // pending amount again, while already-billed sessions never get re-charged.
  function toTimeVal(v) {
    if (!v) return NaN;
    const t = new Date(v).getTime();
    return isNaN(t) ? NaN : t;
  }
  // Latest 'paid' settlement timestamp covering (client, month key), or null
  // when no such column/value exists anywhere (legacy rows → treat as open).
  function getInvoicePaidAt(clientId, mk) {
    const covers = (p) => String(p.invoice_key || '').split('+').indexOf(mk) !== -1;
    let best = null, sawColumn = false;
    const scan = (rows, idEq) => {
      (rows || []).forEach(p => {
        if (!idEq(p) || !covers(p) || String(p.status || 'paid') !== 'paid') return;
        if ('paid_at' in p) sawColumn = true;
        const t = toTimeVal(p.paid_at || p.created_at);
        if (!isNaN(t) && (!best || t > best)) best = t;
      });
    };
    scan((window.APP_STATE && APP_STATE.clientPayments) || [],
      p => sameId(p.client_id, clientId));
    scan(readLocalPayments(),
      p => String(p.client_id) === String(clientId));
    return sawColumn ? best : null;
  }
  function setInvoicePaidAt(clientId, invoiceKey, isoStamp) {
    const apply = (p) => {
      if (String(p.invoice_key || '') === String(invoiceKey) &&
          String(p.status || 'paid') === 'paid') p.paid_at = isoStamp;
    };
    ((window.APP_STATE && window.APP_STATE.clientPayments) || [])
      .forEach(p => { if (sameId(p.client_id, clientId)) apply(p); });
    const loc = readLocalPayments();
    loc.forEach(p => { if (String(p.client_id) === String(clientId)) apply(p); });
    writeLocalPayments(loc);
  }
  async function persistPaidAt(clientId, invoiceKey, isoStamp) {
    const sb = APP_STATE.supabaseClient;
    if (!sb) return;
    try {
      const { error } = await sb.from('client_payments')
        .update({ paid_at: isoStamp })
        .eq('client_id', String(clientId)).eq('invoice_key', String(invoiceKey))
        .eq('status', 'paid');
      if (error) throw error;
    } catch (e) { /* column not migrated yet — local mirror still works */ }
  }
  // Count sessions in a month that were checked in strictly after `afterT`
  // (null/NaN → every session counts). Sessions without a timestamp are
  // always counted so nothing silently goes unbilled.
  function countSessionsAfter(clientId, y, m, afterT) {
    const list = (typeof getSessions === 'function' ? getSessions(clientId, y, m) : []) || [];
    if (isNaN(afterT)) return list.length;
    return list.filter(s => { const t = toTimeVal(s.checked_at); return isNaN(t) || t > afterT; }).length;
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
  // ------------------------------------------------------------
  // 🆕 Payment cut-off: every settled ('paid') invoice remembers its
  // settlement moment (`paid_at`). Sessions whose check-in happened AFTER
  // that stamp are billed again — so once a payment is cleared, any new
  // session created after it (same month or a past paid month) immediately
  // shows up as pending amount instead of hiding behind the paid invoice.
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
    //     🆕 Payment cut-off: if this month was already settled, only
    //     sessions CHECKED IN AFTER the settlement stamp count — so a new
    //     session created after a cleared payment immediately shows up as
    //     pending amount instead of hiding behind the paid invoice.
    const curKey = monthKeyOf(y, m);
    const curPaidAt = getInvoicePaidAt(clientId, curKey);
    const billableSessions = (curPaidAt != null)
      ? countSessionsAfter(clientId, y, m, curPaidAt)
      : getSessions(clientId, y, m).length;
    const sessions = getSessions(clientId, y, m).length;
    const monthDue = billableSessions * rate;
    const thisMonthPaid = isInvoicePaid(clientId, curKey) && billableSessions === 0;

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
      // 🆕 Same payment cut-off for past months: a settled month only
      // re-appears as carry-over when sessions were created AFTER it was
      // paid off (e.g. the trainer marked an extra session for last month).
      const paidAt = getInvoicePaidAt(clientId, key);
      const n = (paidAt != null)
        ? countSessionsAfter(clientId, cy, cm, paidAt)
        : getSessions(clientId, cy, cm).length;
      const amt = n * rate;
      if (amt > 0) {
        if (!isInvoicePaid(clientId, key)) {
          carry.push({ key, label: monthLabel(key), sessions: n, amount: amt });
        } else {
          carry.push({ key, label: monthLabel(key), sessions: n, amount: amt, newSincePayment: true });
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
  // ------------------------------------------------------------
  // 🐛 WHY THE ADMIN "💳 Incoming Payments" TAB USED TO SHOW NOTHING:
  //   1. The cloud fetch had NO retry. On a transient network hiccup the
  //      result stayed [] forever until a full page reload, so declared
  //      transfers never appeared in the admin panel.
  //   2. When the fetch succeeded but returned ZERO rows, the freshly
  //      loaded (empty) cloud list WIPE OUT the optimistic in-memory
  //      copies of locally-recorded declarations — pending requests
  //      literally disappeared from the tab on every re-render/reload.
  //      Now local-only rows are merged back after every load.
  // ============================================================

  // Rows recorded on THIS device (localStorage mirror) that never made it
  // to the cloud (no matching client+invoice+status row remotely). These
  // must always stay visible in the admin panel until synced.
  function localOnlyRows(remoteList) {
    const remoteKey = (p) => `${String(p.client_id)}|${p.invoice_key}|${String(p.status)}`;
    const remoteKeys = new Set((remoteList || []).map(remoteKey));
    return readLocalPayments().filter(p => !remoteKeys.has(remoteKey(p)));
  }

  // Merge locally-recorded rows into APP_STATE.clientPayments without
  // duplicates — used right after every cloud load AND right after a
  // successful persistPayment insert (so the admin sees the declaration
  // instantly, even before Realtime echoes it back).
  function mergeLocalIntoState() {
    if (!APP_STATE) return;
    APP_STATE.clientPayments = APP_STATE.clientPayments || [];
    localOnlyRows(APP_STATE.clientPayments).forEach(p => {
      if (!APP_STATE.clientPayments.some(x => x.__local && String(x.client_id) === String(p.client_id) && x.invoice_key === p.invoice_key && String(x.status) === String(p.status))) {
        APP_STATE.clientPayments.unshift(Object.assign({ __local: true }, p));
      }
    });
  }

  let _loadPayInFlight = false;
  let _loadPayQueuedBehind = false;
  window.loadClientPayments = async function () {
    if (!APP_STATE) return;
    APP_STATE.clientPayments = APP_STATE.clientPayments || [];
    const sb = APP_STATE.supabaseClient;
    if (!sb) { mergeLocalIntoState(); return; }
    if (_loadPayInFlight) {
      // Never RACE two loads — but always honour the latest caller: when an
      // in-flight load finishes it runs one fresh follow-up pass so opening
      // the 💳 tab mid-fetch still pulls the newest declarations.
      _loadPayQueuedBehind = true;
      return;
    }
    _loadPayInFlight = true;
    try {
      // 🔁 Retry up to 3× with a short backoff — one dropped request must
      // NOT leave the Incoming Payments tab empty for the whole session.
      let data = null, error = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        ({ data, error } = await sb.from('client_payments')
          .select('*').order('created_at', { ascending: false }).limit(2000));
        if (!error) break;
        if (typeof window.isMissingTableError === 'function' && window.isMissingTableError(error)) break; // retrying won't help
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      }
      if (!error) {
        APP_STATE.clientPayments = (data || []).map(p => Object.assign({}, p));
        APP_STATE.clientPaymentsCloudOk = true;
        // ⚠️ Do NOT trust the cloud list alone: merge this device's
        // local-only declarations back in so pending requests can never
        // vanish from the admin tab.
        mergeLocalIntoState();
        // Any row that now exists both locally and in the cloud is no
        // longer "local only" — drop its duplicate marker.
        const rk = (p) => `${String(p.client_id)}|${p.invoice_key}|${String(p.status)}`;
        const cloudSet = new Set((data || []).map(rk));
        APP_STATE.clientPayments.forEach(p => { if (p.__local && cloudSet.has(rk(p))) delete p.__local; });
      } else {
        APP_STATE.clientPaymentsCloudOk = false;
        mergeLocalIntoState();
        // Table missing? Try one-time auto-provision (needs service key) —
        // otherwise the localStorage mirror keeps the portal fully working.
        if (typeof window.isMissingTableError === 'function' && window.isMissingTableError(error) &&
          typeof window.ensureTableExists === 'function') {
          try {
            const created = await window.ensureTableExists('client_payments');
            if (created) {
              const again = await sb.from('client_payments')
                .select('*').order('created_at', { ascending: false }).limit(2000);
              if (!again.error) {
                APP_STATE.clientPayments = (again.data || []).map(p => Object.assign({}, p));
                APP_STATE.clientPaymentsCloudOk = true;
                mergeLocalIntoState();
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      APP_STATE.clientPaymentsCloudOk = false;
      try { mergeLocalIntoState(); } catch (e2) {}
      console.warn('loadClientPayments:', e);
    } finally {
      _loadPayInFlight = false;
      if (_loadPayQueuedBehind) {
        _loadPayQueuedBehind = false;
        // A refresh was requested while this load was mid-flight — run one
        // fresh pass so the newest declarations are never missed.
        window.loadClientPayments().catch(() => {});
      }
    }
  };

  // Merge a freshly-paid invoice into the in-memory state right away so the
  // "Amount due" tile drops to zero instantly (no wait for a reload).
  function recordPaidLocally(clientId, mk, method, amount, ref) {
    return recordRowLocally(clientId, mk, method, amount, ref, 'paid');
  }
  function recordRowLocally(clientId, mk, method, amount, ref, status, note) {
    const rec = {
      client_id: String(clientId), invoice_key: mk, amount_due: amount,
      currency: CUR(), method, reference: ref || '', status,
      // 📝 Optional client note — stored in the `reference` column when no
      // UTR was given, otherwise appended after " | ". The admin pending
      // card reads it back via paymentNote(p).
      note: note || '',
      created_at: new Date().toISOString()
    };
    // 🆕 Payment cut-off stamp: 'paid' rows remember the exact settlement
    // moment so the balance engine can bill sessions created afterwards.
    if (status === 'paid') rec.paid_at = rec.created_at;
    addLocalPayment(rec);
    if (APP_STATE.clientPayments) {
      if (!APP_STATE.clientPayments.some(p => sameId(p.client_id, clientId) && p.invoice_key === mk && p.status === status)) {
        APP_STATE.clientPayments.unshift(rec);
      }
    }
    // 💳 A brand-new declaration just landed → repaint the admin Incoming
    // Payments tab immediately (same-device flow, and the trainer's own
    // manual/cash records go through this path too).
    try { window.renderAdminPaymentPanel(); } catch (e) {}
    return rec;
  }

  // Persist a completed payment. Cloud first; on failure fall back to the
  // local mirror and queue for retry so the balance still clears.
  function persistPayment(clientId, mk, method, amount, ref, status, note) {
    status = status || 'paid';
    const rec = recordRowLocally(clientId, mk, method, amount, ref, status, note);
    const sb = APP_STATE.supabaseClient;
    if (!sb) return Promise.resolve({ ok: true, cloud: false });
    // 🐛 BUG FIX (nothing showed in the admin tab): the insert used to be
    // fire-and-forget — the admin panel had no way of knowing a NEW pending
    // declaration arrived until a full reload / Realtime echo. Now we ask
    // for the created row back (.select()) and merge it into
    // APP_STATE.clientPayments immediately, then re-render the panel.
    const doInsert = (payload) => sb.from('client_payments').insert(payload).select().single();
    return doInsert({
      client_id: String(clientId), invoice_key: mk, amount_due: amount,
      currency: CUR(), method, reference: ref || '', status,
      // 🆕 Settlement cut-off stamp (null for 'pending' declarations — the
      // column is added by sql/client_payments.sql; if it doesn't exist yet
      // the insert fails and the local mirror + retry queue keep working).
      paid_at: (status === 'paid') ? rec.created_at : null
    }).then(({ data, error }) => {
      if (error) {
        // Older schema without paid_at? Retry once WITHOUT the new column so
        // payments never get lost on unmigrated databases.
        return doInsert({
          client_id: String(clientId), invoice_key: mk, amount_due: amount,
          currency: CUR(), method, reference: ref || '', status
        }).then((r2) => ({ data: r2.data, error: r2.error })).catch(() => ({ error }));
      }
      return { data, error: null };
    }).then(({ data, error }) => {
      if (error) {
        // Queue for retry on next load (e.g. table migration not run yet).
        APP_STATE._pendingPaymentRetry = APP_STATE._pendingPaymentRetry || [];
        APP_STATE._pendingPaymentRetry.push(Object.assign({}, rec, { id: undefined, pending_retry: true }));
        return { ok: true, cloud: false, error };
      }
      APP_STATE.clientPaymentsCloudOk = true;
      // Attach the real cloud row (with its uuid id!) to the in-memory copy
      // so approve/reject from the admin panel updates THAT row.
      if (data && data.id) {
        rec.id = data.id;
        const list = readLocalPayments();
        const m = list.find(p => p.client_id === rec.client_id && p.invoice_key === rec.invoice_key && p.status === rec.status && p.created_at === rec.created_at);
        if (m) { m.id = data.id; writeLocalPayments(list); }
        if (APP_STATE.clientPayments) {
          const st = APP_STATE.clientPayments.find(p => p.client_id === rec.client_id && p.invoice_key === rec.invoice_key && p.status === rec.status && p.created_at === rec.created_at);
          if (st) st.id = data.id; else APP_STATE.clientPayments.unshift(Object.assign({}, data));
        }
      }
      try { window.renderAdminPaymentPanel(); } catch (e) {}
      return { ok: true, cloud: true };
    }).catch((e) => ({ ok: true, cloud: false, error: e }));
  }

  // Retry queued payments once the cloud table becomes available.
  async function flushPendingPaymentRetry() {
    const pend = (APP_STATE && APP_STATE._pendingPaymentRetry) || [];
    const sb = APP_STATE && APP_STATE.supabaseClient;
    if (!pend.length || !sb) return;
    const remaining = [];
    let synced = 0;
    for (const row of pend) {
      try {
        const clean = Object.assign({}, row); delete clean.pending_retry;
        const { error } = await sb.from('client_payments').insert(clean);
        if (error) remaining.push(row); else synced++;
      } catch (e) { remaining.push(row); }
    }
    APP_STATE._pendingPaymentRetry = remaining;
    if (synced) {
      console.info(`💳 ${synced} queued payment(s) synced to cloud.`);
      try { await window.loadClientPayments(); } catch (e) {}
      try { window.renderAdminPaymentPanel(); } catch (e) {}
    }
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

  // Shared escaper for everything this file injects as HTML.
  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // Clipboard helper with a fallback for older / non-secure contexts so a
  // copy tap NEVER silently fails.
  function copyToClipboard(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt)
        .then(() => true)
        .catch(() => legacyCopy(txt));
    }
    return Promise.resolve(legacyCopy(txt));
  }
  function legacyCopy(txt) {
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, txt.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  // ============================================================
  // 🏦 TRAINER BANK DETAILS — read-only in the client portal
  // ------------------------------------------------------------
  // The values are whatever the ADMIN last saved (admin_config row wins
  // over js/config.js defaults). Clients see them in the "Pay For Your
  // Sessions" card as a small read-only summary; the FULL details pop up
  // only when they tap a payment button. Every value is strictly
  // NON-editable (plain text spans — never inputs/contenteditable) and
  // each one can be copied INDIVIDUALLY with its own 📋 button so it can
  // be pasted straight into the client's banking app.
  // ============================================================
  function detailRowsFromConfig(cfg) {
    const rows = [];
    if (cfg.bankName) rows.push({ label: '🏦 Bank name', value: cfg.bankName });
    if (cfg.bankAccountName) rows.push({ label: '👤 Account holder', value: cfg.bankAccountName });
    if (cfg.bankIban) rows.push({ label: '🔢 IBAN', value: cfg.bankIban });
    if (cfg.bankSwift) rows.push({ label: '🌐 SWIFT/BIC', value: cfg.bankSwift });
    if (cfg.bankUpi) rows.push({ label: '📱 UPI ID', value: cfg.bankUpi });
    if (cfg.paypalLink) rows.push({ label: '🅿️ PayPal.me', value: cfg.paypalLink });
    return rows;
  }

  // Mask a value for the pre-payment summary (keep it recognisable only).
  function maskValue(v) {
    const s = String(v);
    if (s.length <= 4) return '••••';
    return s.slice(0, 2) + '••••••' + s.slice(-2);
  }

  // One read-only detail line: label · value (masked or full) · 📋 copy.
  // The copy button ALWAYS copies the real value even while masked.
  function detailLineHTML(label, value, masked) {
    const shown = masked ? maskValue(value) : value;
    return `<div class="bank-detail-line">` +
      `<span class="bd-label">${escHtml(label)}</span>` +
      `<strong class="bd-value" title="${escHtml(value)}">${escHtml(shown)}</strong>` +
      `<button type="button" class="bd-copy" data-copy-val="${escHtml(value)}" aria-label="Copy ${escHtml(label)}">📋</button>` +
      `</div>`;
  }

  // Delegated copy handler for any [data-copy-val] element inside `root`.
  function bindCopyButtons(root) {
    if (!root || root.dataset.copyBound === 'yes') return;
    root.dataset.copyBound = 'yes';
    root.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-copy-val]');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      const val = btn.getAttribute('data-copy-val');
      copyToClipboard(val).then((ok) => {
        toast(ok ? '📋 Copied — paste it straight into your banking app.'
                 : '⚠️ Could not copy automatically — long-press the value to copy.',
              ok ? 'success' : 'info');
      });
    });
  }

  // Read-only trainer-details block. 🔒 PRIVACY: this block is NEVER shown
  // on the home screen anymore. It only appears AFTER the client taps a
  // payment button (e.g. 🏦 Bank Transfer) — see revealCoachDetails().
  // The modal itself (tasShowBankTransferModal) already carries its own
  // full-detail sheet, so nothing leaks on the dashboard beforehand.
  function coachDetailsBlockHTML(cfg, info) {
    if (!info || !info.revealed) return ''; // hidden until a payment tap
    const rows = detailRowsFromConfig(cfg);
    let head = `<div class="payment-coach-title">🏦 Coach's transfer details <span class="pc-chip">updated by your coach</span></div>`;
    if (!rows.length) {
      return `<div class="payment-coach-details">${head}<div class="pc-empty">Your coach hasn't saved transfer details yet. Tap “🏦 Bank Transfer” below and follow the on-screen instructions.</div></div>`;
    }
    return `<div class="payment-coach-details coach-reveal">` +
      head +
      `<div class="pc-hint">Read-only — exactly as updated by your coach. Tap 📋 beside any line to copy that single detail for pasting into your banking app.</div>` +
      rows.map(r => detailLineHTML(r.label, r.value, false)).join('') +
      `<div class="pc-lock-note">🔒 Values cannot be edited here — they come directly from your coach's account settings.</div>` +
      `</div>`;
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
    // Full trainer details pop up ONLY now — when the client is actually
    // making a payment. Each line carries its own 📋 copy button so the
    // value can be copied individually and pasted into their banking app.
    const rows = detailRowsFromConfig(cfg);
    const detailLines = rows.length
      ? rows.map(r => detailLineHTML(r.label, r.value, false)).join('')
      : `<div class="bank-detail-line"><span class="bd-label">ℹ️ How to pay</span><strong class="bd-value">Open your banking app and send the exact amount below directly to your coach's account, then tap "I have transferred" here so they can verify and clear your balance.</strong></div>`;
    const esc = escHtml;

    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-overlay tas-card-modal';
      wrap.innerHTML = `<div class="modal-card tas-card-modal-card">
        <div class="modal-title">🏦 Direct bank transfer</div>
        <p class="modal-subhead">Transfer <strong>${esc(fmtMoney(amount))}</strong> straight into the trainer's account using the details below, then tap "I have transferred". Your coach verifies the payment and your balance clears right after.</p>
        <div class="bank-details" id="tasBankDetails">
          ${detailLines}
          <div class="bank-detail-line"><span class="bd-label">💵 Amount</span><strong class="bd-value">${fmtMoney(amount)}</strong><button type="button" class="bd-copy" data-copy-val="${esc(amount.toFixed(2))}" aria-label="Copy amount">📋</button></div>
        </div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.2rem;">
          <button class="btn-secondary" id="tasBankCopy" type="button" style="width:auto;">📋 Copy all details</button>
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
      // 📋 per-line copy buttons (each detail copied individually).
      bindCopyButtons(wrap);

      const waText = `Hi Coach, I have transferred ${fmtMoney(amount)} (${opts.label || ''}) to your account.`;
      const waNum = (window.APP_CONFIG && APP_CONFIG.TRAINER_WHATSAPP) || '';
      const waLink = $id('tasBankWa');
      waLink.href = waNum ? `https://wa.me/${String(waNum).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(waText)}` : '#';
      if (!waNum) waLink.style.display = 'none';

      $id('tasBankCopy').onclick = () => {
        const txt = rows.map(r => `${r.label.replace(/^\S+\s/, '')}: ${r.value}`).join('\n') + `\nAmount: ${amount.toFixed(2)} ${CUR()}`;
        copyToClipboard(txt).then((ok) => {
          toast(ok ? '📋 All bank details copied.' : '⚠️ Could not copy automatically — use the 📋 button on each line.', ok ? 'success' : 'info');
        });
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

  // ---- shared declaration sheet (🅿️ PayPal / ✔️ Record payment) ----------
  // A proper modal — like the bank one — where the client enters their
  // reference/UTR number and an optional note before declaring the payment.
  // Resolves { declared, reference, note } so persistPayment finally stores
  // real values (previously these were never captured → the admin card
  // always showed "—" for Reference and Note).
  window.tasShowDeclareSheet = function (opts) {
    const amount = Number(opts.amount) || 0;
    const esc = escHtml;
    const refLabel = opts.method === 'paypal' ? 'PayPal transaction/Payee ID (optional)'
      : opts.method === 'cash' ? 'Receipt/reference (optional)'
      : 'Reference / UTR number (recommended)';
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-overlay tas-card-modal';
      wrap.innerHTML = `<div class="modal-card tas-card-modal-card">
        <div class="modal-title">${esc(opts.title || '💳 Confirm your payment')}</div>
        <p class="modal-subhead">${esc(opts.message || `I have paid ${fmtMoney(amount)}.`)}</p>
        <label class="tas-declare-field"><span>${esc(refLabel)}</span>
          <input class="input" id="tasDeclRef" placeholder="e.g. UTR 9988776655 / txn id" autocomplete="off" /></label>
        <label class="tas-declare-field"><span>Note for your coach (optional)</span>
          <input class="input" id="tasDeclNote" placeholder="e.g. Paid from HDFC savings" autocomplete="off" /></label>
        <div class="modal-actions">
          <button class="btn-secondary" id="tasDeclCancel" type="button">Not yet</button>
          <button class="btn-primary" id="tasDeclOk" type="button" style="width:auto;">✅ I have paid — notify my coach</button>
        </div>
        <p style="font-size:.8rem;opacity:.7;margin:.4rem 0 0;">⚠️ Your balance clears as soon as your coach verifies the money arrived.</p>
      </div>`;
      document.body.appendChild(wrap);
      $id('tasDeclCancel').onclick = () => { wrap.remove(); resolve({ declared: false }); };
      $id('tasDeclOk').onclick = () => {
        const reference = ($id('tasDeclRef').value || '').trim();
        const note = ($id('tasDeclNote').value || '').trim();
        wrap.remove();
        resolve({ declared: true, reference, note });
      };
    });
  };

  // Read the human note back off a payment row (real `note` column wins,
  // otherwise the part after " | " inside the reference string).
  function paymentNote(p) {
    if (!p) return '';
    if (p.note) return String(p.note);
    const ref = String(p.reference || '');
    const i = ref.indexOf(' | ');
    return i >= 0 ? ref.slice(i + 3) : '';
  }
  function paymentReference(p) {
    if (!p) return '';
    const ref = String(p.reference || '');
    const i = ref.indexOf(' | ');
    return i >= 0 ? ref.slice(0, i) : ref;
  }

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

    const finalize = async (method, ref, note) => {
      busy(true);
      try {
        // 🐛 FIX: manual/cash records used to be stored as status 'paid',
        // which meant they NEVER appeared as approval requests in the
        // admin "💳 Incoming Payments" tab. They are now 'pending'
        // declarations like bank/PayPal — the coach approves them there.
        const res = await persistPayment(c.id, invoiceKey, method, amount, ref, 'pending', note);
        if (!res.cloud) {
          toast('💾 Payment recorded — will sync to the cloud automatically. Thank you!', 'warning', 5000);
        } else {
          toast('✅ Payment noted! Your coach will confirm receipt — until then the amount stays due.', 'success', 4500);
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
            // 📝 Ask for the UTR/reference + note so the admin card shows
            // real details instead of "—".
            const sheet = await window.tasShowDeclareSheet({
              amount, method: 'bank',
              title: '🏦 Confirm your transfer',
              message: `Enter the reference/UTR of the ${fmtMoney(amount)} transfer${opts.label ? ' for ' + opts.label : ''} so your coach can match it in their bank statement.`
            });
            if (!sheet.declared) { toast('ℹ️ No payment recorded — your balance stays due.', 'info'); return; }
            const ref = [ 'declared:' + nowStamp(), sheet.reference || '' ].filter(Boolean).join(' · ');
            const res = await persistPayment(c.id, invoiceKey, 'bank_transfer', amount,
              ref, 'pending', sheet.note);
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
      const sheet = await window.tasShowDeclareSheet({
        amount, method: 'cash',
        title: '💳 Record your payment',
        message: `Recording a payment of ${fmtMoney(amount)}${label ? ' for ' + label : ''}. Add a reference below if you have one — your coach verifies and approves it from the 💳 Incoming Payments tab.`
      });
      if (sheet.declared) finalize('cash_or_transfer', ['manual:' + nowStamp(), sheet.reference || ''].filter(Boolean).join(' · '), sheet.note);
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
      <div id="coachDetailsSlot"></div>
      <div class="payment-methods" id="paymentMethods" role="group" aria-label="Payment methods"></div>
      <div class="payment-history-wrap">
        <div class="payment-history-title">🧾 Payment history</div>
        <div id="paymentHistoryList" class="payment-history-list"></div>
      </div>`;
    anchor.parentNode.insertBefore(div, anchor.nextSibling);
    bindPaymentEvents(div);
    bindCopyButtons(div); // 📋 buttons inside the read-only coach-details block
    return div;
  }

  // Reveal the trainer's FULL details ONLY after the client taps a payment
  // button (e.g. 🏦 Bank Transfer). Before that tap, nothing is rendered in
  // this slot at all — no blurred lines, no masked values on the home screen.
  function revealCoachDetails() {
    const slot = $id('coachDetailsSlot');
    if (!slot) return;
    // Already revealed? Don't re-render / re-animate on repeat taps.
    if (slot.dataset.revealed === 'yes') return;
    slot.dataset.revealed = 'yes';
    const cfg = window.getPaymentProviderConfig();
    slot.innerHTML = coachDetailsBlockHTML(cfg, { revealed: true });
    bindCopyButtons(slot);
    toast("👀 Trainer's transfer details revealed — tap 📋 on any line to copy it individually.", 'info', 5000);
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
    // 📝 Declaration sheet instead of a bare confirm() — captures the
    // PayPal transaction id + an optional note so the admin card shows them.
    const sheet = await window.tasShowDeclareSheet({
      amount, method: 'paypal',
      title: '🅿️ Confirm PayPal payment',
      message: `In the PayPal page that just opened, pay ${fmtMoney(amount)} (${label}) with your linked Visa/Mastercard, Apple Pay or Samsung Pay — money goes straight to your coach. Once done, tap below so they can verify and clear your balance.`
    });
    if (!sheet.declared) { toast('ℹ️ No payment recorded — your balance stays due.', 'info'); return; }
    const ref = ['declared:' + nowStamp(), sheet.reference || ''].filter(Boolean).join(' · ');
    const res = await persistPayment(c.id, invoiceKey, cloudMethod, amount, ref, 'pending', sheet.note);
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
        // Client is trying to pay → the trainer's full details are revealed
        // (they stay blurred/masked in the card until this moment).
        revealCoachDetails();
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
              // 📝 Capture reference/UTR + note so the admin card is complete.
              const sheet = await window.tasShowDeclareSheet({
                amount: info.totalDue, method: 'bank',
                title: '🏦 Confirm your transfer',
                message: `Enter the reference/UTR of the ${fmtMoney(info.totalDue)} transfer so your coach can match it in their bank statement.`
              });
              if (!sheet.declared) { toast('ℹ️ No payment recorded — your balance stays due.', 'info'); return; }
              const ref = ['declared:' + nowStamp(), sheet.reference || ''].filter(Boolean).join(' · ');
              const res = await persistPayment(c.id, keys.slice().sort().join('+'), 'bank_transfer', info.totalDue, ref, 'pending', sheet.note);
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
          `<div class="payment-line carry"><span>${m.label} — ${m.sessions} session${m.sessions === 1 ? '' : 'es'}${m.newSincePayment ? ' <em style="opacity:.75;font-size:.85em;">(new since last payment)</em>' : ''}</span><strong>${fmtMoney(m.amount)}</strong></div>`).join('');
      }
      breakdown.innerHTML = html;
    }

    if (totalRow) {
      totalRow.innerHTML = info.allClear
        ? `<span>Total due</span><strong class="zero">${CUR()} 0 — all clear 🎉</strong>`
        : `<span>Total due now</span><strong class="due">${fmtMoney(info.totalDue)}</strong>`;
    }

    if (methods) {
      const slot = $id('coachDetailsSlot');
      if (slot) {
        // 🔒 PRIVACY + UX: the coach's transfer details belong ONLY to the
        // payment flow — they must never sit on the home screen. The slot is
        // therefore empty by default and gets filled when the client taps a
        // payment button (revealCoachDetails, wired to every method click).
        // Two extra rules:
        //   • once the balance is fully paid (allClear) the block is cleared
        //     again — nothing lingers on the home after payment is done;
        //   • while still unpaid, later re-renders (10s polls / realtime
        //     syncs) keep the revealed block visible via a diff check, so
        //     identical HTML is never re-written (prevents flicker).
        const revealed = slot.dataset.revealed === 'yes' && !info.allClear;
        if (!revealed) slot.dataset.revealed = '';
        const nextHTML = coachDetailsBlockHTML(window.getPaymentProviderConfig(),
          { revealed });
        if (slot.innerHTML !== nextHTML) slot.innerHTML = nextHTML;
        if (revealed) bindCopyButtons(slot);
      }
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
    // 🛡️ BLINK FIX: only touch the DOM when the value actually changed — an
    // identical re-write used to fire the counter MutationObserver + pop-in
    // animations on every 60s poll / realtime sync, making the tile flicker.
    const tile = $id('clientDashAmount');
    if (tile) {
      const tileText = `${CUR()} ${(info.totalDue || 0).toLocaleString('en-US')}`;
      if (tile.textContent !== tileText) tile.textContent = tileText;
    }

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
  // Admin-only gate: the panel must NEVER appear in a client portal.
  // 1. If the client dashboard is currently visible, this is a client
  //    session — hide unconditionally, even if an admin login is also
  //    remembered on the same device/browser.
  // 2. Otherwise require BOTH an admin-remembered session AND the admin
  //    dashboard actually being present & visible in the DOM.
  function isAdminSession() {
    try {
      const cd = document.getElementById('clientDashboard');
      if (cd && !cd.classList.contains('hidden')) return false; // client portal open
      const ad = document.getElementById('adminDashboard');
      const adminVisible = !!ad && !ad.classList.contains('hidden');
      const sess = (typeof window.tasLoadSession === 'function') ? window.tasLoadSession() : null;
      const adminSess = !!(sess && sess.role === 'admin');
      return adminVisible && adminSess;
    } catch (e) { return false; }
  }

  function removeAdminPaymentPanel() {
    // The old floating side bubble (removed in favour of the top tab).
    const fab = document.getElementById('adminPaymentPanelFab');
    if (fab) fab.remove();
    // Clients must never see the 💳 Incoming Payments workspace or its tab.
    const ws = document.getElementById('adminWorkspacePayments');
    if (ws) ws.classList.add('hidden');
    const tabBtn = document.getElementById('adminTabPaymentsBtn');
    if (tabBtn) tabBtn.classList.add('hidden');
    const host = document.getElementById('adminPaymentPanelHost');
    if (host) host.innerHTML = '';
  }

  function ensureAdminPaymentPanel() {
    // 📑 The panel now lives inside the admin workspace tab bar
    // ("💳 Incoming Payments" next to Home / Clients / Calculators) instead
    // of floating at the side of the screen as a fixed bubble.
    // 🐛 FIX (tab was EMPTY): an old client-portal build REMOVED the whole
    // #adminWorkspacePayments div from the DOM; every later render then
    // created a detached host appended straight to <body>, so the 💳 tab
    // pointed at nothing and showed no requests, no approve buttons and no
    // settings. Now the workspace + host are re-created inside the admin
    // dashboard whenever they are missing, and the host is ALWAYS parented
    // into the workspace — never left floating on <body>.
    let wsVis = document.getElementById('adminWorkspacePayments');
    if (!wsVis) {
      const ad = document.getElementById('adminDashboard');
      if (!ad) return null;
      wsVis = document.createElement('div');
      wsVis.id = 'adminWorkspacePayments';
      wsVis.className = 'admin-workspace hidden';
      const tabsBar = ad.querySelector('.admin-workspace-tabs') ||
        document.getElementById('adminWorkspaceHome');
      if (tabsBar && tabsBar.parentNode === ad) ad.insertBefore(wsVis, tabsBar.nextSibling);
      else ad.appendChild(wsVis);
    }
    let host = document.getElementById('adminPaymentPanelHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'adminPaymentPanelHost';
    }
    // 🪗 CLICK-TO-EXPAND: the host must NEVER carry a stale inline display
    // value. An old version wrote display:block/none here on every render;
    // that inline style beat the workspace's .hidden class, so the panel
    // either leaked into the other admin tabs or stayed stuck when the tab
    // collapsed — and cards looked "not expandable". Visibility is now
    // owned exclusively by js/workspace.js showAdminWorkspaceTab().
    // Always (re-)parent the host INTO the workspace — never <body>.
    wsVis.appendChild(host);
    const tabBtn = document.getElementById('adminTabPaymentsBtn');
    if (tabBtn) tabBtn.classList.remove('hidden');
    host.style.removeProperty('display');
    // 🩹 If the 💳 tab is the ACTIVE one right now, reveal the workspace
    // immediately. Otherwise it stays hidden until the trainer clicks the
    // tab (workspace.js owns the accordion open/collapse).
    if (window.__activeAdminTab === 'payments') wsVis.classList.remove('hidden');
    return host;
  }

  // 🔒 Guard against re-entrant renders: settleTransfer() → toast →
  // renderAdminPaymentPanel() and the dashboard MutationObserver can both
  // fire while a render is mid-flight. Without this guard the second call
  // replaces panel.innerHTML right between "list built" and "handlers
  // attached", leaving freshly rendered cards with NO click handlers —
  // which is exactly why rows stopped expanding.
  let renderInProgress = false;
  let rerenderQueued = false;

  window.renderAdminPaymentPanel = function () {
    if (renderInProgress) { rerenderQueued = true; return; }
    renderInProgress = true;
    try { doRenderAdminPaymentPanel(); }
    finally {
      renderInProgress = false;
      if (rerenderQueued) { rerenderQueued = false; setTimeout(() => window.renderAdminPaymentPanel(), 0); }
    }
    // 🩹 SELF-HEAL: the 💳 tab button / workspace can be re-injected by
    // other code paths AFTER this render ran (login, dashboard switch),
    // leaving them stuck with the stale 'hidden' class from
    // removeAdminPaymentPanel() — which looks exactly like "the tab shows
    // nothing". Re-assert their visibility a moment later for admin
    // sessions whenever they are still hidden.
    setTimeout(healPaymentsTabVisibility, 400);
  };

  function healPaymentsTabVisibility() {
    try {
      if (!isAdminSession()) return;                       // clients stay clean
      const ws = document.getElementById('adminWorkspacePayments');
      if (!ws) return;                                     // not on this page
      const activeTab = window.__activeAdminTab;
      const tabBtn = document.getElementById('adminTabPaymentsBtn');
      if (tabBtn && tabBtn.classList.contains('hidden')) tabBtn.classList.remove('hidden');
      // Only un-hide the WORKSPACE when the 💳 tab is actually the active
      // one — never fight showAdminWorkspaceTab()'s collapse state.
      if (activeTab === 'payments') {
        ws.classList.remove('hidden');
        const host = document.getElementById('adminPaymentPanelHost');
        if (host && host.style.display === 'none') host.style.removeProperty('display');
      }
    } catch (e) {}
  }

  // 🔄 Pull the latest declarations straight from the cloud, then re-render.
  // Used when the 💳 tab is opened and by the 🔄 Refresh button — this is
  // what makes freshly declared client transfers actually SHOW UP in the
  // admin "Incoming Payments" tab without a full page reload.
  let _payRefreshInFlight = false;
  window.refreshIncomingPayments = async function () {
    if (_payRefreshInFlight) return;
    _payRefreshInFlight = true;
    try {
      if (APP_STATE && APP_STATE.supabaseClient && typeof window.loadClientPayments === 'function') {
        await window.loadClientPayments();
      }
      mergeLocalIntoState();
    } catch (e) { /* offline — local mirror still renders */ }
    finally {
      _payRefreshInFlight = false;
      try { window.renderAdminPaymentPanel(); } catch (e) {}
    }
  };

  function doRenderAdminPaymentPanel() {
    const show = APP_STATE && APP_STATE.supabaseClient ? true : !!(APP_STATE && isAdminSession());
    // Admin-only: in a client portal the panel element is removed from the
    // DOM entirely (not just hidden), so clients can never see or reach it.
    if (!show || !isAdminSession()) { removeAdminPaymentPanel(); return; }
    const panel = ensureAdminPaymentPanel();   // host div inside the 💳 tab workspace
    if (!panel) return;                         // admin dashboard not in the DOM yet

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const attr = (s) => esc(s).replace(/'/g, '&#39;');
    const nameOf = (cid) => { try { const cl = getClientSafe(cid); return cl ? (cl.name || cl.id) : String(cid); } catch (e) { return String(cid); } };
    const cfg = window.getPaymentProviderConfig();
    // 🐛 FIX ("nothing is coming"): dedupe by a key that matches how rows
    // are actually stored — reference/note live in `reference` as
    // "REF | note", so the old key based on p.note never matched and every
    // declaration rendered TWICE (or was dropped inconsistently).
    const payKey = (p) => `${String(p.client_id)}|${p.invoice_key}|${String(p.status)}|${Math.floor(new Date(p.created_at || 0).getTime() / 1000)}`;
    const seenPay = new Set();
    const allRows = [];
    const addRow = (p) => { if (!p || String(p.status) !== 'pending') return; const k = payKey(p); if (seenPay.has(k)) return; seenPay.add(k); allRows.push(p); };
    (APP_STATE.clientPayments || []).forEach(addRow);
    readLocalPayments().forEach(addRow);
    const rows = allRows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    // ☁️ Cloud not reachable? Say so right on the panel instead of silently
    // showing an empty list ("nothing is coming").
    const cloudOk = APP_STATE.clientPaymentsCloudOk !== false;

    // 📑 Tab badge: show the pending count directly on the top
    // "💳 Incoming Payments" tab button.
    const payBadge = document.getElementById('adminPaymentsTabCount');
    if (payBadge) {
      payBadge.textContent = rows.length;
      payBadge.classList.toggle('hidden', !rows.length);
    }

    panel.style.cssText = 'background:var(--card,#fff);border:1px solid var(--line,#ddd);border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.08);padding:.9rem 1rem;max-width:720px;margin:0 auto;';
    // 🐛 BUG FIX: do NOT write an inline display on the panel based on the
    // workspace class anymore. The old line set display:block whenever the
    // workspace element existed without .hidden — but other code paths
    // (MutationObserver re-renders) could run while the workspace was being
    // toggled, leaving a stale inline value that either hid the panel after
    // opening the tab ("not getting expanded") or leaked it into other tabs.
    // Visibility is now controlled ONLY by the workspace + host elements.
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;">
        <strong>💳 Incoming Payments</strong>
        <span style="display:flex;gap:.4rem;align-items:center;">
          <button class="btn-secondary btn-small" id="apRefresh" type="button" style="width:auto;" title="Fetch the newest declarations from the cloud">🔄 Refresh</button>
          <button class="btn-secondary btn-small" id="apToggleBody" type="button" style="width:auto;">${rows.length ? `🔔 ${rows.length} pending` : '⚙️ Settings'}</button>
        </span>
      </div>
      ${cloudOk ? '' : `<div style="margin-top:.5rem;font-size:.8rem;color:#b7791f;background:rgba(255,196,0,.12);border:1px solid rgba(183,121,31,.35);border-radius:10px;padding:.45rem .6rem;">⚠️ Could not reach the cloud — showing payments recorded on THIS device only. Clients who paid from another device will appear once the connection returns (tap 🔄 Refresh).</div>`}
      <div id="apBody" class="${rows.length ? '' : 'hidden'}" style="margin-top:.6rem;display:flex;flex-direction:column;gap:.5rem;">
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
    if (rows.length) { body.classList.remove('hidden'); body.style.display = ''; }
    panel.querySelector('#apRefresh').onclick = async () => {
      const btn = panel.querySelector('#apRefresh');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Loading…'; }
      try { await window.refreshIncomingPayments(); } catch (e) {}
    };
    panel.querySelector('#apToggleBody').onclick = () => {
      // Robust toggle: the CSS .hidden rule uses display:none!important, so
      // flipping BOTH the class and the inline display guarantees the
      // panel really expands/collapses on every click.
      const nowHidden = !body.classList.contains('hidden');
      body.classList.toggle('hidden', nowHidden);
      body.style.display = nowHidden ? 'none' : 'flex';
      const tgl = panel.querySelector('#apToggleBody');
      if (tgl) tgl.setAttribute('aria-expanded', String(!nowHidden));
    };

    // 🪗 ACCORDION state for the pending cards: clicking a card header
    // expands its full details, clicking again collapses it. The Set
    // survives re-renders (panel.onclick re-runs renderAdminPaymentPanel
    // after approve/reject), so freshly rendered cards keep their state.
    if (!window.__tasPayExpanded) window.__tasPayExpanded = new Set();
    const expanded = window.__tasPayExpanded;
    const rowKeyOf = (p, i) => String(p.id || payKey(p) || ('idx-' + i));

    // 🖊 EDIT state: which declaration key is currently in edit mode.
    if (!window.__tasPayEditing) window.__tasPayEditing = null;
    const editingKey = window.__tasPayEditing;

    const list = panel.querySelector('#adminPendingList');
    list.innerHTML = rows.length
      ? rows.map((p, i) => {
        const rk = rowKeyOf(p, i);
        const isOpen = expanded.has(rk) || editingKey === rk;
        const isEditing = editingKey === rk;
        const months = String(p.invoice_key || '').split('+').map(monthLabel).join(' + ');
        const refShown = paymentReference(p) || '—';
        const noteShown = paymentNote(p) || '—';
        const detailInner = isEditing ? `
            <input class="input tas-edit-field" data-edit-field="amount" inputmode="decimal" placeholder="Amount" value="${attr(p.amount_due != null ? p.amount_due : '')}" />
            <select class="input tas-edit-field" data-edit-field="method">
              <option value="bank_transfer"${String(p.method) === 'bank_transfer' ? ' selected' : ''}>🏦 Bank Transfer</option>
              <option value="paypal"${String(p.method) === 'paypal' ? ' selected' : ''}>🅿️ PayPal</option>
              <option value="cash_or_transfer"${String(p.method) === 'cash_or_transfer' ? ' selected' : ''}>💵 Cash / Transfer</option>
            </select>
            <input class="input tas-edit-field" data-edit-field="reference" placeholder="Reference / UTR" value="${attr(paymentReference(p))}" />
            <input class="input tas-edit-field" data-edit-field="note" placeholder="Note" value="${attr(paymentNote(p))}" />
            <div style="display:flex;gap:.4rem;margin-top:.3rem;flex-wrap:wrap;">
              <button class="btn-secondary btn-small" data-edit-cancel="1" type="button" style="width:auto;">✖ Cancel</button>
              <button class="btn-primary btn-small" data-save-pay="${attr(rk)}" data-pay-row="${attr(rk)}" type="button" style="width:auto;">💾 Save changes</button>
            </div>` : `
            <div><b>Client:</b> ${esc(nameOf(p.client_id))} <span style="opacity:.6">(id: ${esc(p.client_id)})</span></div>
            <div><b>Billing month(s):</b> ${esc(months)}</div>
            <div><b>Amount declared:</b> ${esc(fmtMoney(p.amount_due))}</div>
            <div><b>Method:</b> ${esc(methodLabel(p.method))}</div>
            <div><b>Reference / UTR:</b> ${esc(refShown)}</div>
            <div><b>Note from client:</b> ${esc(noteShown)}</div>
            <div><b>Declared at:</b> ${esc(p.created_at ? new Date(p.created_at).toLocaleString() : '—')}</div>
            <div style="display:flex;gap:.4rem;margin-top:.5rem;flex-wrap:wrap;">
              <button class="btn-secondary btn-small" data-reject-pay="${attr(p.id || '')}" data-lc-client="${attr(p.client_id)}" data-lc-key="${attr(p.invoice_key)}" type="button" style="width:auto;">❌ Not received</button>
              <button class="btn-primary btn-small" data-approve-pay="${attr(p.id || '')}" data-lc-client="${attr(p.client_id)}" data-lc-key="${attr(p.invoice_key)}" data-amount="${attr(p.amount_due)}" type="button" style="width:auto;">✅ Money received</button>
              <button class="btn-secondary btn-small" data-edit-pay="${attr(rk)}" type="button" style="width:auto;" title="Edit amount, method, reference or note before approving">🖊 Edit details</button>
            </div>`;
        return `
        <div class="tas-pay-card${isOpen ? ' open' : ''}${isEditing ? ' editing' : ''}" data-pay-key="${attr(rk)}">
          <div class="tas-pay-head" role="button" tabindex="0" aria-expanded="${isOpen}" data-pay-toggle="${attr(rk)}">
            <span class="tas-pay-chev" aria-hidden="true">▶</span>
            <strong>${esc(nameOf(p.client_id))}</strong>
            <span class="tas-pay-amount">${esc(fmtMoney(p.amount_due))}</span>
          </div>
          <div class="tas-pay-meta">${esc(months)}${String(p.invoice_key || '').includes('+') ? ' (+ carried months)' : ''} · ${esc(methodLabel(p.method))} · ${esc(p.created_at ? new Date(p.created_at).toLocaleString() : '')}</div>
          <div class="tas-pay-detail${isOpen ? ' open' : ''}">
            ${detailInner}
          </div>
        </div>`;
      }).join('')
      : `<div style="opacity:.7;">✅ No transfers awaiting verification. New client declarations appear here automatically — tap 🔄 Refresh to pull the latest.</div>`;

    // 🖊 Helper: find the underlying row object from its display key. The
    // rows array is rebuilt on every render, so this lookup always reads
    // the CURRENTLY displayed row objects (same references the cards use).
    const rowByKey = (rk) => {
      rk = String(rk == null ? '' : rk);
      return rows.find((p, i) => rowKeyOf(p, i) === rk) ||
             rows.find(p => String(p.id || '') === rk) || null;
    };
    // 💾 Pending edit saves that couldn't be applied in a previous render
    // pass — re-applied here against the fresh rows before painting.
    if (window.__tasPayPendingSaves && window.__tasPayPendingSaves.length) {
      window.__tasPayPendingSaves.forEach(s => {
        const p = rowByKey(s.key);
        if (p) { p.amount_due = s.amount; p.method = s.method; p.reference = s.reference; p.note = s.note; }
      });
      window.__tasPayPendingSaves = [];
    }

    // Delegated expand/collapse for the payment cards. Bound ONCE on the
    // persistent host element (#adminPaymentPanelHost) — NOT on the panel
    // div itself, because renderAdminPaymentPanel() replaces that div's
    // innerHTML on every re-render (approve/reject path), which used to
    // wipe out any listener attached to it and left freshly rendered
    // cards dead to clicks ("not getting expanded"). Delegation from the
    // host survives every re-render. Capture phase so it always fires.
    if (!panel.__tasPayToggleBound) {
      panel.__tasPayToggleBound = true;
      panel.addEventListener('click', (ev) => {
        try {
          const head = ev.target && ev.target.closest ? ev.target.closest('[data-pay-toggle]') : null;
          if (!head) return;
          if (ev.target.closest('[data-approve-pay],[data-reject-pay],[data-edit-pay],[data-save-pay],[data-edit-cancel],#apSaveBank')) return;
          const key = head.getAttribute('data-pay-toggle');
          const card = head.closest('.tas-pay-card');
          const detail = card && card.querySelector('.tas-pay-detail');
          const willOpen = !expanded.has(key);
          if (willOpen) expanded.add(key); else expanded.delete(key);
          if (card) card.classList.toggle('open', willOpen);
          if (detail) detail.classList.toggle('open', willOpen);
          head.setAttribute('aria-expanded', String(willOpen));
        } catch (e) { /* never break the click chain */ }
      }, true);
      // Keyboard access: Enter/Space on a focused card header toggles it.
      panel.addEventListener('keydown', (ev) => {
        try {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          const head = ev.target && ev.target.closest ? ev.target.closest('[data-pay-toggle]') : null;
          if (!head) return;
          ev.preventDefault();
          head.click();
        } catch (e) {}
      }, true);
    }

    panel.onclick = async (ev) => {
      const ap = ev.target.closest('[data-approve-pay]');
      const rj = ev.target.closest('[data-reject-pay]');
      const ed = ev.target.closest('[data-edit-pay]');
      const sv = ev.target.closest('[data-save-pay]');
      const cx = ev.target.closest('[data-edit-cancel]');
      if (ap) {
        // 🐛 FIX: the old amount lookup grabbed a random sibling <span> and
        // silently stored 0 when it missed — use the data-amount written at
        // render time, falling back to the row itself.
        const amt = Number(ap.dataset.amount) || (rowByKey(rowKeyOf({ id: ap.dataset.approvePay }, -1)) || {}).amount_due || 0;
        await settleTransfer(ap.dataset.approvePay, ap.dataset.lcClient, ap.dataset.lcKey, 'paid', amt);
      }
      else if (rj) { await settleTransfer(rj.dataset.rejectPay, rj.dataset.lcClient, rj.dataset.lcKey, 'rejected'); }
      else if (ed) {
        window.__tasPayEditing = ed.dataset.editPay;
        expanded.add(ed.dataset.editPay);
        window.renderAdminPaymentPanel();
      }
      else if (cx) {
        window.__tasPayEditing = null;
        window.renderAdminPaymentPanel();
      }
      else if (sv) {
        try {
          const rk = sv.dataset.savePay;
          const cardEl = sv.closest('.tas-pay-card');
          const p = rowByKey(rk);
          if (!p || !cardEl) { toast('⚠️ Row not found — tap 🔄 Refresh and try again.', 'warning'); return; }
          const g = (f) => { const el = cardEl.querySelector(`[data-edit-field="${f}"]`); return el ? String(el.value).trim() : ''; };
          const newAmount = parseFloat(g('amount').replace(/[^0-9.\-]/g, ''));
          const newMethod = g('method') || p.method;
          const newRef = g('reference');
          const newNote = g('note');
          if (!(newAmount > 0)) { toast('⚠️ Enter a valid amount greater than 0.', 'warning'); return; }
          const mergedRef = [newRef, newNote].filter(Boolean).join(' | ');
          // 1 · Update the in-memory copy immediately (instant UI feedback).
          p.amount_due = newAmount; p.method = newMethod;
          p.reference = mergedRef; p.note = newNote;
          // Also queue the change so it is re-applied against freshly
          // rebuilt rows on the next render pass (a concurrent cloud
          // refresh could otherwise paint the old values once more).
          window.__tasPayPendingSaves = window.__tasPayPendingSaves || [];
          window.__tasPayPendingSaves.push({ key: rk, id: p.id || null, amount: newAmount, method: newMethod, reference: mergedRef, note: newNote });
          // 2 · Update the local mirror too (same natural key).
          try {
            const loc = readLocalPayments();
            let touched = false;
            loc.forEach(x => {
              if (String(x.client_id) === String(p.client_id) && x.invoice_key === p.invoice_key &&
                  String(x.status) === 'pending' && (!p.id || String(x.id || '') === String(p.id || ''))) {
                x.amount_due = newAmount; x.method = newMethod; x.reference = mergedRef; x.note = newNote; touched = true;
              }
            });
            if (touched) writeLocalPayments(loc);
          } catch (e) {}
          // Mirror the edit onto every in-memory row with the same id/key.
          (APP_STATE.clientPayments || []).forEach(x => {
            if ((p.id && String(x.id || '') === String(p.id)) ||
                (!p.id && String(x.client_id) === String(p.client_id) && x.invoice_key === p.invoice_key && String(x.status) === 'pending')) {
              x.amount_due = newAmount; x.method = newMethod; x.reference = mergedRef; x.note = newNote;
            }
          });
          // 3 · Push to the cloud when the row has an id (or look it up).
          const sb = APP_STATE.supabaseClient;
          let cloudDone = false;
          if (sb) {
            const payload = { amount_due: newAmount, method: newMethod, reference: mergedRef };
            try {
              let targetId = p.id;
              if (!targetId) {
                const { data: found } = await sb.from('client_payments')
                  .select('id').eq('client_id', String(p.client_id)).eq('invoice_key', p.invoice_key)
                  .eq('status', 'pending').order('created_at', { ascending: false }).limit(1);
                if (found && found.length) targetId = found[0].id;
              }
              if (targetId) {
                const { error } = await sb.from('client_payments').update(payload).eq('id', targetId);
                if (!error) { cloudDone = true; p.id = targetId; try { window.__tasPayPendingSaves = []; } catch (e2) {} }
              }
            } catch (e) { /* offline — local edits still apply */ }
          }
          window.__tasPayEditing = null;
          toast(cloudDone ? '💾 Payment details updated and synced to the cloud.'
                          : '💾 Payment details updated on this device — will sync when the connection returns.',
                cloudDone ? 'success' : 'warning', 5000);
          window.renderAdminPaymentPanel();
          renderAll();
        } catch (e) { console.error('save payment edit:', e); toast('❌ Could not save the changes: ' + e.message, 'error'); }
      }
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
    // 🆕 Settlement cut-off stamp — recorded the moment money is approved so
    // sessions created AFTER this payment immediately show as pending amount.
    const settleStamp = new Date().toISOString();
    if (sb && rowId) {
      try {
        const upd = (newStatus === 'paid') ? { status: newStatus, paid_at: settleStamp } : { status: newStatus };
        let { error } = await sb.from('client_payments').update(upd).eq('id', rowId);
        if (error && newStatus === 'paid' && /paid_at/i.test(String(error.message || ''))) {
          // Column not migrated yet — flip status only.
          ({ error } = await sb.from('client_payments').update({ status: newStatus }).eq('id', rowId));
        }
        cloudDone = !error;
        if (error) toast('⚠️ Cloud update failed: ' + error.message, 'error');
      } catch (e) { toast('⚠️ Cloud update failed: ' + e.message, 'error'); }
    } else if (sb && !rowId) {
      // 🐛 FIX: declarations made while offline never got a cloud uuid, so
      // approving them used to be a no-op in the database — the client's
      // portal kept showing the amount due forever. Now we look the row up
      // by its natural key (client + invoice + 'pending') and update it.
      try {
        const { data: found, error: selErr } = await sb.from('client_payments')
          .select('id').eq('client_id', String(clientId)).eq('invoice_key', invoiceKey)
          .eq('status', 'pending').order('created_at', { ascending: false }).limit(1);
        if (!selErr && found && found.length) {
          const upd = (newStatus === 'paid') ? { status: newStatus, paid_at: settleStamp } : { status: newStatus };
          let { error } = await sb.from('client_payments').update(upd).eq('id', found[0].id);
          if (error && newStatus === 'paid' && /paid_at/i.test(String(error.message || ''))) {
            ({ error } = await sb.from('client_payments').update({ status: newStatus }).eq('id', found[0].id));
          }
          cloudDone = !error;
          if (error) toast('⚠️ Cloud update failed: ' + error.message, 'error');
        }
      } catch (e) { /* offline — local mirror below still flips the status */ }
    }
    const loc = readLocalPayments();
    let touched = false;
    loc.forEach(p => {
      if (String(p.client_id) === String(clientId) && p.invoice_key === invoiceKey && String(p.status) === 'pending') {
        p.status = newStatus; touched = true;
        if (newStatus === 'paid') p.paid_at = settleStamp;
      }
    });
    if (touched) writeLocalPayments(loc);
    (APP_STATE.clientPayments || []).forEach(p => {
      if ((rowId && String(p.id) === String(rowId)) ||
          (sameId(p.client_id, clientId) && p.invoice_key === invoiceKey && String(p.status) === 'pending')) {
        p.status = newStatus;
        if (newStatus === 'paid') p.paid_at = settleStamp;
      }
    });
    if (!cloudDone && sb && newStatus === 'paid') {
      // Declaration was made offline (localStorage only) — push a paid row now.
      try {
        await sb.from('client_payments').insert({
          client_id: String(clientId), invoice_key: invoiceKey, amount_due: amount || 0,
          currency: CUR(), method: 'bank_transfer', reference: 'approved-offline-declaration',
          status: 'paid', paid_at: settleStamp
        });
      } catch (e) {}
    }
    if (newStatus === 'paid') setInvoicePaidAt(clientId, invoiceKey, settleStamp);
    toast(newStatus === 'paid'
      ? '✅ Approved — the client\'s balance is cleared.'
      : '❌ Marked as not received — the amount stays due and carries over.', newStatus === 'paid' ? 'success' : 'info', 5000);
    window.renderAdminPaymentPanel();
    renderAll();
    // Keep the revenue tile + approvals-style badge honest after settling.
    try { if (typeof renderHomeStats === 'function') renderHomeStats(); } catch (e) {}
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
    // Watch the admin/client dashboard visibility directly, so the panel
    // appears ONLY while the admin dashboard is on screen and is removed
    // the moment a client portal (or the login card) is shown — even if
    // other code paths re-render without calling renderAll().
    try {
      const dashObserver = new MutationObserver(() => {
        try { window.renderAdminPaymentPanel(); } catch (e) {}
      });
      const watch = () => {
        ['adminDashboard', 'clientDashboard'].forEach(id => {
          const el = document.getElementById(id);
          if (el) dashObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
        });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
      else watch();
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
