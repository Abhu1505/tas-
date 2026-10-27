// End-to-end smoke test for the admin "💳 Incoming Payments" tab expansion.
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
    if (src) {
      if (src.startsWith('http')) continue;
      let code;
      try { code = fs.readFileSync(src.split('?')[0], 'utf8'); } catch { console.log('MISSING FILE:', src); continue; }
      w.eval(code);
    } else if (s.textContent.trim()) w.eval(s.textContent);
  } catch (e) { errors.push(`SCRIPT ${src || 'inline'}: ${e && e.message}`); }
}
w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

setTimeout(() => {
  const d = w.document;

  // --- Fake an ADMIN session ------------------------------------------
  w.APP_STATE.clients = [{ id: 1, login_id: 'ADM001', password_hint: 'pass', name: 'Rohan', active: true }];
  w.APP_STATE.adminConfig = w.APP_STATE.adminConfig || {};
  w.tasLoadSession = () => ({ role: 'admin' });
  d.getElementById('loginCard').classList.add('hidden');
  d.getElementById('adminDashboard').classList.remove('hidden');

  // Seed one pending declared transfer (localStorage mirror used by payments.js)
  w.localStorage.setItem('tas_client_payments_v1', JSON.stringify([{
    id: 'loc1', client_id: 1, invoice_key: '2026-10', amount_due: 500,
    method: 'bank_transfer', reference: 'UTR-998877', note: 'Paid from HDFC',
    created_at: '2026-10-20T09:00:00Z', status: 'pending'
  }]));

  // 1️⃣ Click the 💳 Incoming Payments tab → workspace + panel must expand
  const payTab = d.querySelector('.tab-btn[data-atab2="payments"]');
  if (!payTab) { errors.push('MISSING payments tab button'); }
  else {
    payTab.click();
    const ws = d.getElementById('adminWorkspacePayments');
    const host = d.getElementById('adminPaymentPanelHost');
    const visible = ws && !ws.classList.contains('hidden');
    const hostShown = host && host.style.display === 'block';
    console.log('TAB click → workspace visible:', visible, '| host shown:', hostShown);
    if (!visible || !hostShown) errors.push('Payments tab did not expand');
    const title = host && host.textContent.includes('Incoming Payments');
    console.log('Panel rendered with title:', !!title);
    if (!title) errors.push('Panel content missing');
  }

  // 2️⃣ A pending card must exist; clicking its header expands details
  const head = d.querySelector('[data-pay-toggle]');
  if (!head) errors.push('No pending payment card rendered');
  else {
    const card = head.closest('.tas-pay-card');
    const detail = card.querySelector('.tas-pay-detail');
    const beforeOpen = detail.classList.contains('open');
    head.click();
    const afterOpen = detail.classList.contains('open');
    console.log('Card click → detail open:', beforeOpen, '→', afterOpen,
      '| aria-expanded:', head.getAttribute('aria-expanded'),
      '| chevron rotate css present:', /tas-pay-card\.open \.tas-pay-chev/.test(fs.readFileSync('css/styles.css','utf8')));
    if (!afterOpen || beforeOpen) errors.push('Card detail did not toggle open on click');
    // click again → collapse
    head.click();
    console.log('Second click → collapsed:', !detail.classList.contains('open'));
    if (detail.classList.contains('open')) errors.push('Card detail did not collapse on second click');
    head.click(); // reopen — must survive nothing (no re-render here)
  }

  // 3️⃣ Re-render (approve/reject path calls renderAdminPaymentPanel) must
  //     KEEP the expanded state and still have working handlers.
  w.renderAdminPaymentPanel();
  const head2 = d.querySelector('[data-pay-toggle]');
  const detail2 = head2 && head2.closest('.tas-pay-card').querySelector('.tas-pay-detail');
  console.log('After re-render, expanded state preserved:', !!(detail2 && detail2.classList.contains('open')));
  if (!(detail2 && detail2.classList.contains('open'))) errors.push('Expanded state lost after re-render');
  if (head2) {
    head2.click();
    console.log('Handler works after re-render (toggled closed):', !detail2.classList.contains('open'));
    if (detail2.classList.contains('open')) errors.push('Handler broken after re-render');
  }

  // 4️⃣ 🔔 header toggle button collapses/expands whole body
  const tgl = d.getElementById('apToggleBody');
  const body = d.getElementById('apBody');
  const wasHidden = body.classList.contains('hidden');
  tgl.click();
  const nowHidden = body.classList.contains('hidden');
  console.log('Header toggle flips body hidden:', wasHidden, '→', nowHidden, '| inline display:', body.style.display);
  if (wasHidden === nowHidden) errors.push('Header toggle did not flip body');

  // 5️⃣ Tab accordion: clicking payments tab again collapses the workspace
  payTab.click();
  const ws2 = d.getElementById('adminWorkspacePayments');
  console.log('Second tab click collapses workspace:', ws2.classList.contains('hidden'));
  if (!ws2.classList.contains('hidden')) errors.push('Tab did not collapse on second click');
  payTab.click();
  console.log('Third tab click re-expands:', !ws2.classList.contains('hidden'));
  if (ws2.classList.contains('hidden')) errors.push('Tab did not re-expand');

  console.log('--- ERRORS (' + errors.length + ') ---');
  errors.forEach(e => console.log(e));
  process.exit(errors.length ? 1 : 0);
}, 400);
