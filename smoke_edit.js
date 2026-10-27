// Test: pending requests appear + Edit details flow in admin Incoming Payments
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => { const s = a.join(' '); if (!/Not implemented|Could not parse CSS|css/i.test(s)) errors.push('console.error: ' + s); });
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://localhost/', virtualConsole: vc });
const w = dom.window;
w.matchMedia = q => ({ matches: false, addEventListener(){}, addListener(){} });
if (!w.IntersectionObserver) w.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
w.scrollTo = () => {};
for (const s of [...w.document.querySelectorAll('script')]) {
  const src = s.getAttribute('src');
  try {
    if (src) { if (src.startsWith('http')) continue;
      let code; try { code = fs.readFileSync(src.split('?')[0], 'utf8'); } catch { console.log('MISSING FILE:', src); continue; }
      w.eval(code);
    } else if (s.textContent.trim()) w.eval(s.textContent);
  } catch (e) { errors.push(`SCRIPT ${src || 'inline'}: ${e && e.message}`); }
}
w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
setTimeout(() => {
  const d = w.document;
  w.APP_STATE.clients = [{ id: 7, name: 'Aarav', active: true }];
  w.APP_STATE.adminConfig = w.APP_STATE.adminConfig || {};
  w.tasLoadSession = () => ({ role: 'admin' });
  d.getElementById('loginCard').classList.add('hidden');
  d.getElementById('adminDashboard').classList.remove('hidden');
  // Two pending declarations: one cloud row with id, one local-only (no id)
  w.APP_STATE.clientPayments = [
    { id: 'c1', client_id: 7, invoice_key: '2026-09+2026-10', amount_due: 1500, method: 'bank_transfer', reference: 'declared:x | UTR-111', status: 'pending', created_at: '2026-10-21T10:00:00Z' },
    { client_id: 7, invoice_key: '2026-10', amount_due: 300, method: 'cash_or_transfer', reference: 'manual:y', note: 'paid cash', status: 'pending', created_at: '2026-10-22T10:00:00Z' }
  ];
  w.localStorage.setItem('tas_client_payments_v1', '[]');

  const payTab = d.querySelector('.tab-btn[data-atab2="payments"]');
  payTab.click();
  const cards = d.querySelectorAll('.tas-pay-card');
  console.log('Pending cards rendered:', cards.length);
  if (cards.length !== 2) errors.push('Expected 2 pending cards, got ' + cards.length);
  const badge = d.getElementById('adminPaymentsTabCount');
  console.log('Tab badge count:', badge.textContent, 'hidden:', badge.classList.contains('hidden'));
  if (badge.textContent !== '2' || badge.classList.contains('hidden')) errors.push('Badge wrong');

  // Expand first card and press 🖊 Edit details
  const head = cards[0].querySelector('[data-pay-toggle]');
  head.click();
  const editBtn = cards[0].querySelector('[data-edit-pay]');
  if (!editBtn) errors.push('No Edit button on expanded card');
  editBtn.click();
  const card1 = d.querySelector('.tas-pay-card.editing');
  const fields = card1 ? card1.querySelectorAll('[data-edit-field]') : [];
  console.log('Edit mode opened with fields:', fields.length);
  if (fields.length !== 4) errors.push('Edit form missing fields: ' + fields.length);
  // Change amount + reference, save
  card1.querySelector('[data-edit-field="amount"]').value = '1200';
  card1.querySelector('[data-edit-field="reference"]').value = 'UTR-999';
  card1.querySelector('[data-save-pay]').click();
  setTimeout(() => {
    const updated = w.APP_STATE.clientPayments.find(p => p.id === 'c1');
    console.log('Row after save: amount=', updated.amount_due, 'ref=', updated.reference);
    if (updated.amount_due !== 1200) errors.push('Amount not updated');
    if (!/UTR-999/.test(updated.reference)) errors.push('Reference not updated');
    const c = d.querySelector('.tas-pay-card');
    console.log('Re-render shows new amount:', /1,?200/.test(c.textContent));
    // Approve the second (local-only) row via data-amount fallback
    const cardsNow = d.querySelectorAll('.tas-pay-card');
    const approveBtn = cardsNow[cardsNow.length - 1].querySelector('[data-approve-pay]');
    approveBtn.click();
    setTimeout(() => {
      const pendNow = (w.APP_STATE.clientPayments || []).filter(p => String(p.status) === 'pending').length;
      console.log('Pending rows after approve:', pendNow);
      if (pendNow !== 1) errors.push('Approve did not settle the row');
      console.log('--- ERRORS (' + errors.length + ') ---');
      errors.forEach(e => console.log(e));
      process.exit(errors.length ? 1 : 0);
    }, 100);
  }, 100);
}, 400);
