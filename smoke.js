const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => { const s = a.join(' '); if (!s.includes('Not implemented')) errors.push('console.error: ' + s); });

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'https://localhost/',
  virtualConsole: vc,
});
const w = dom.window;
// minimal stubs
w.matchMedia = w.matchMedia || (q => ({ matches: false, addEventListener(){}, addListener(){} }));
if (!w.IntersectionObserver) w.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
if (!w.ResizeObserver) w.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
try { w.scrollTo = () => {}; } catch(e){}

const scripts = [...dom.window.document.querySelectorAll('script')];
let idx = 0;
for (const s of scripts) {
  idx++;
  const src = s.getAttribute('src');
  try {
    if (src) {
      if (src.startsWith('http')) continue;
      const path = src.split('?')[0];
      let code;
      try { code = fs.readFileSync(path, 'utf8'); } catch { console.log('MISSING FILE:', path); continue; }
      w.eval(code);
    } else {
      const t = s.textContent.trim();
      if (!t) continue;
      w.eval(t);
    }
  } catch (e) {
    errors.push(`SCRIPT #${idx} ${src || 'inline'}: ${e && e.message}`);
  }
}

// fire DOMContentLoaded
try { w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true })); } catch (e) { errors.push('DCL: ' + e.message); }

setTimeout(() => {
  console.log('--- ERRORS (' + errors.length + ') ---');
  errors.slice(0, 40).forEach(e => console.log(e));
  process.exit(0);
}, 500);
