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
  // Fake client login
  w.APP_STATE.clients = [{ id: 1, login_id: 'CLI001', password_hint: 'pass', name: 'Test Client', active: true }];
  w.APP_STATE.adminConfig = w.APP_STATE.adminConfig || {};
  try { w.openClientDashboard(w.APP_STATE.clients[0], 'pass'); } catch (e) { errors.push('openClientDashboard: ' + e.message); }

  // Test tab switching through all tabs
  const tabs = ['history','progress','calculators','tools','profile','plan'];
  for (const t of tabs) {
    const btn = d.querySelector(`.tab-btn[data-ctab="${t}"]`);
    if (!btn) { errors.push('MISSING TAB BUTTON: ' + t); continue; }
    btn.click();
    const panel = d.getElementById('ctab-' + t);
    const visible = panel && !panel.classList.contains('hidden');
    const active = btn.classList.contains('active');
    console.log(`TAB ${t}: panelVisible=${visible} btnActive=${active}`);
    if (!visible || !active) errors.push(`TAB SWITCH BROKEN: ${t}`);
  }

  // Animations checks
  console.log('html.js-anim present:', d.documentElement.classList.contains('js-anim'));
  const bar = d.querySelector('.tabs-bar.client-tabs');
  console.log('tabs-indicator exists:', bar ? !!bar.querySelector('.tabs-indicator') : 'NO BAR');
  const dash = d.getElementById('clientDashboard');
  console.log('clientDashboard hidden:', dash.classList.contains('hidden'));

  // Profile edit shim + Add entry
  try { w.tasOpenProfileEdit(); } catch(e){ errors.push('tasOpenProfileEdit: '+e.message); }
  try { w.tasOpenAddEntry(); } catch(e){ errors.push('tasOpenAddEntry: '+e.message); }
  const pm = d.getElementById('progressModal');
  console.log('progressModal after tasOpenAddEntry hidden?', pm ? pm.classList.contains('hidden') : 'MODAL MISSING');

  // Edit profile button click
  const ep = d.getElementById('clientEditProfileBtn');
  console.log('clientEditProfileBtn exists:', !!ep);

  setTimeout(() => {
    console.log('--- ERRORS (' + errors.length + ') ---');
    errors.slice(0,50).forEach(e => console.log(e));
    process.exit(0);
  }, 800);
}, 400);
