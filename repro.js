// Reproduction harness for the two broken tabs:
//   🧮 Calculators  (client portal tab + admin workspace tab)
//   💳 Incoming Payments (admin workspace tab)
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

  // ===================== CLIENT PORTAL =====================
  w.APP_STATE.clients = [{ id: 1, login_id: 'CLI001', password_hint: 'pass', name: 'Test Client', active: true }];
  w.APP_STATE.adminConfig = w.APP_STATE.adminConfig || {};
  // Approved profile so the calculators have data to show
  w.APP_STATE.clientProfiles = [];
  try {
    w.APP_STATE.clientProfiles.push({ client_id: 1, fit_weight_kg: 80, fit_height_cm: 178, fit_age: 30,
      fit_gender: 'Male', fit_activity_level: 'Moderately Active', fit_goal: 'Cut',
      fit_waist_cm: 90, fit_neck_cm: 38, fit_hip_cm: 98, fit_bench_kg: 70, fit_body_fat_pct: null });
  } catch (e) {}
  try { w.openClientDashboard(w.APP_STATE.clients[0], 'pass'); } catch (e) { errors.push('openClientDashboard: ' + e.message); }

  const calcBtn = d.querySelector('.tab-btn[data-ctab="calculators"]');
  calcBtn.click();
  const calcPanel = d.getElementById('ctab-calculators');
  const hub = d.getElementById('clientCalcHub');
  console.log('\n=== 🧮 CALCULATORS (client portal) ===');
  console.log('panel visible:', !calcPanel.classList.contains('hidden'));
  console.log('hub innerHTML length:', hub ? hub.innerHTML.length : 'HUB MISSING');
  console.log('shared-input boxes found:', d.querySelectorAll('#clientCalcHub .calc-shared-inputs').length);
  console.log('input fields in hub:', d.querySelectorAll('#clientCalcHub [data-fitkey]').length);
  console.log('calc cards rendered:', d.querySelectorAll('#clientCalcHub .calc-card').length);
  console.log('empty CTA shown:', !!d.querySelector('#clientCalcHub .calc-empty-cta'));
  console.log('profile note text:', (d.querySelector('#calcProfileNoteC') || {}).textContent);
  console.log('first card result:', (() => { const c = d.querySelector('#clientCalcHub .calc-card .calc-result'); return c ? c.textContent : 'NONE'; })());

  // ===================== ADMIN =====================
  w.tasLoadSession = () => ({ role: 'admin' });
  d.getElementById('loginCard').classList.add('hidden');
  d.getElementById('clientDashboard').classList.add('hidden');
  d.getElementById('adminDashboard').classList.remove('hidden');

  const adminCalcBtn = d.querySelector('.tab-btn[data-atab2="calculators"]');
  adminCalcBtn.click();
  const aws = d.getElementById('adminWorkspaceCalculators');
  console.log('\n=== 🧮 CALCULATORS (admin workspace) ===');
  console.log('workspace visible:', !aws.classList.contains('hidden'));
  console.log('shared-input boxes found:', d.querySelectorAll('#adminCalcHub .calc-shared-inputs').length);
  console.log('input fields in hub:', d.querySelectorAll('#adminCalcHub [data-fitkey]').length);
  console.log('calc cards rendered:', d.querySelectorAll('#adminCalcHub .calc-card').length);
  console.log('reset button present:', !!d.querySelector('#adminCalcHub .calc-reset-btn'));

  const payTab = d.querySelector('.tab-btn[data-atab2="payments"]');
  payTab.click();
  const host = d.getElementById('adminPaymentPanelHost');
  console.log('\n=== 💳 INCOMING PAYMENTS (admin) ===');
  console.log('workspace visible:', !d.getElementById('adminWorkspacePayments').classList.contains('hidden'));
  console.log('host display:', host.style.display);
  console.log('cards:', d.querySelectorAll('.tas-pay-card').length);
  const head = d.querySelector('[data-pay-toggle]');
  if (head) {
    head.click();
    const card = head.closest('.tas-pay-card');
    const detail = card.querySelector('.tas-pay-detail');
    console.log('detail open after click:', detail.classList.contains('open'));
    const editBtn = card.querySelector('[data-edit-pay]');
    if (editBtn) {
      editBtn.click();
      const c2 = d.querySelector('.tas-pay-card.editing');
      console.log('edit mode opened:', !!c2, 'fields:', c2 ? c2.querySelectorAll('[data-edit-field]').length : 0);
      if (c2) {
        c2.querySelector('[data-edit-field="amount"]').value = '1200';
        c2.querySelector('[data-edit-field="reference"]').value = 'UTR-999';
        c2.querySelector('[data-save-pay]').click();
        setTimeout(() => {
          const row = (w.APP_STATE.clientPayments || []).find(p => p.id === 'c1') ||
                      JSON.parse(w.localStorage.getItem('tas_client_payments_v1') || '[]').find(p => p.id === 'loc1');
          console.log('row after save: amount=', row && row.amount_due, 'ref=', row && row.reference);
          console.log('\n--- ERRORS (' + errors.length + ') ---');
          errors.slice(0, 40).forEach(e => console.log(e));
          process.exit(0);
        }, 300);
      } else { console.log('NO EDIT CARD'); process.exit(0); }
    } else { console.log('NO EDIT BUTTON'); process.exit(0); }
  } else { console.log('NO PAYMENT CARD RENDERED'); process.exit(0); }
}, 600);
