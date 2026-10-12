// ============================================================
// CLIENT PORTAL — robust action wiring + professional PDF export
// ------------------------------------------------------------
// WHY THIS FILE EXISTS (bug report: "👤 My Profile → ✏️ Edit Profile"
// and "📈 Your Progress → ➕ Add Entry" did nothing):
//   Both buttons were bound ONCE inside main.js bind(), which runs at
//   DOMContentLoaded and throws on its FIRST missing element / failed
//   listener — every binding after that point silently never attached.
//   On top of that, openProgressModal() had no guard: if ANY modal
//   field was missing it threw before the modal ever appeared. Result:
//   dead buttons with zero feedback.
// FIX:
//   • Every handler here is wrapped in try/catch and looks elements up
//     lazily at click time (never at load time).
//   • The buttons use event delegation on document — they work even if
//     the markup is re-rendered or this script loads late.
//   • A guaranteed opener (window.tasOpenProfileEdit / tasOpenAddEntry)
//     prefills whatever fields exist and always shows the modal, so the
//     user gets a working dialog plus a toast when data isn't loaded yet.
//   • 🧮 Calculators tab gains a "📄 Generate PDF Report" button that
//     produces an advanced, professionally designed multi-section PDF
//     (branded cover, KPI dashboard, BMI gauge, macro chart, HR zones,
//     15-result grid, progress trend table & charts, signature/footer).
// ============================================================
(function () {
  'use strict';

  const $id = (x) => (typeof x === 'string' ? document.getElementById(x) : x);

  // ---------- tiny helpers ----------
  function f1(v) { return Number.isFinite(v) ? v.toFixed(1) : '—'; }
  function f2(v) { return Number.isFinite(v) ? v.toFixed(2) : '—'; }
  function i0(v) { return Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—'; }
  function todayISO() { return new Date().toISOString().split('T')[0]; }

  // ============================================================
  // 1 · 👤 MY PROFILE — the ✏️ Edit Profile modal was MERGED into the
  //     single inline form on the Profile tab (js/progress.js →
  //     renderClientProfile). Basic details + 📌 Shared Inputs are now
  //     ONE form sent for approval at once with "📩 Save to Profile".
  //     window.tasOpenProfileEdit is kept as a compatibility shim: it
  //     simply switches to the Profile tab and focuses the merged form.
  // ============================================================
  window.tasOpenProfileEdit = function () {
    const S = window.APP_STATE;
    const c = S && S.loggedInClient;
    if (!c) {
      showToastSafe('🔐 Please sign in first to edit your profile.', 'info');
      const login = $id('loginIdInput');
      if (login) { try { login.focus(); } catch (e) {} }
      return;
    }
    try {
      const tabBtn = document.querySelector('.tab-btn[data-ctab="profile"]');
      if (tabBtn) tabBtn.click();
    } catch (e) { /* cosmetic only */ }
    setTimeout(() => {
      const first = $id('pfHeight') || $id('pcx-weight');
      if (first) { try { first.focus(); } catch (e) {} }
    }, 250);
    showToastSafe('👤 All profile fields are editable right here — press “📩 Save to Profile” to submit everything together.', 'info');
  };

  // ============================================================
  // 2 · ➕ ADD ENTRY — guaranteed-working progress modal opener
  // ============================================================
  window.tasOpenAddEntry = function () {
    try {
      const S = window.APP_STATE;
      const c = S && S.loggedInClient;
      if (!c) {
        showToastSafe('🔐 Please sign in first to log progress.', 'info');
        const login = $id('loginIdInput');
        if (login) login.focus();
        return;
      }
      if (typeof window.openProgressModal === 'function') {
        try {
          window.openProgressModal(null, c.id, 'client');
          return;
        } catch (e) { console.warn('openProgressModal failed, using fallback:', e); }
      }
      // Fallback: fill whatever exists and reveal the modal ourselves.
      const hid = $id('editProgressId'); if (hid) hid.value = '';
      const title = $id('progressModalTitle'); if (title) title.textContent = '➕ Add My Progress';
      const date = $id('pgDate'); if (date) date.value = todayISO();
      ['pgWeight', 'pgBodyFat', 'pgChest', 'pgWaist', 'pgHips', 'pgArms', 'pgThighs', 'pgNotes', 'pgPhoto']
        .forEach(id => { const el = $id(id); if (el) el.value = ''; });
      const modal = $id('progressModal');
      if (!modal) { showToastSafe('⚠️ Progress form not found — please reload the page.', 'error'); return; }
      modal.classList.remove('hidden');
      const st = $id('progressModalStatus'); if (st) st.textContent = '';
      const w = $id('pgWeight'); if (w) setTimeout(() => { try { w.focus(); } catch (e) {} }, 250);
    } catch (err) {
      console.error('tasOpenAddEntry:', err);
      const modal = $id('progressModal');
      if (modal) modal.classList.remove('hidden');
      showToastSafe('⚠️ Prefill hiccup — please type your entry and save.', 'warning');
    }
  };

  function showToastSafe(msg, type) {
    try { if (typeof window.showToast === 'function') window.showToast(msg, type || 'info'); } catch (e) {}
  }

  // ============================================================
  // 3 · Delegated click wiring — works regardless of render order,
  //     duplicate bindings are harmless because we route through
  //     the guarded openers above.
  // ============================================================
  // 🛡️ Each handler is individually try/catch wrapped: a failure in one
  // action can never break the others (this was the original bug pattern).
  function safe(fn) {
    return function (e) {
      try { fn(e); } catch (err) {
        console.error('[client-portal] handler failed:', err);
        showToastSafe('⚠️ Something went wrong: ' + (err && err.message ? err.message : err), 'error');
      }
    };
  }
  // 🛡️ IMPORTANT: never call stopPropagation() here. The profile-edit modal
  // and the progress modal close when a click lands on their backdrop, and
  // those overlay listeners live on the overlay ELEMENT — stopping bubbling
  // at the document level used to swallow them, which made the modals feel
  // "dead" (open → can't dismiss / confusing state). preventDefault keeps
  // the button's native behaviour tidy without breaking anything.
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#clientEditProfileBtn')) { e.preventDefault(); safe(window.tasOpenProfileEdit)(e); }
    else if (t.closest('#clientAddProgressBtn')) { e.preventDefault(); safe(window.tasOpenAddEntry)(e); }
    else if (t.closest('#calcPdfBtn')) { e.preventDefault(); safe(window.tasGenerateCalcPDF)(e); }
  }, true);

  // ============================================================
  // 3b · 👤 MY PROFILE — ONE merged form (the old ✏️ Edit Profile modal
  //      and its pc*/pe* inputs were REMOVED). js/progress.js renders the
  //      single inline form on the Profile tab; its "📩 Save to Profile"
  //      button submits basic details + 📌 Shared Inputs together as ONE
  //      profile approval. The functions below are kept only as safe
  //      compatibility shims for any stale call-site: they route to that
  //      one real flow instead of a second duplicate form.
  // ============================================================
  window.tasSubmitProfileEdit = async function () {
    // Route to the single merged form's submit button (js/progress.js).
    const tabBtn = document.querySelector('.tab-btn[data-ctab="profile"]');
    if (tabBtn) { try { tabBtn.click(); } catch (e) {} }
    const btn = $id('pcxSubmitBtn');
    if (btn) { btn.click(); return; }
    showToastSafe('👤 Use “📩 Save to Profile” in My Profile — all items are submitted together there.', 'info');
  };

  // Delegated fallback for client tab switching (Plan/History/Progress/
  // Calculators/Profile): only attaches listeners for buttons that exist,
  // and works even if main.js bind() ever fails on an unrelated element.
  function ensureClientTabBindings() {
    document.querySelectorAll('.tab-btn[data-ctab]').forEach(btn => {
      if (btn.dataset.ctabBound === '1') return;
      btn.dataset.ctabBound = '1';
      btn.addEventListener('click', safe(() => {
        const tab = btn.dataset.ctab;
        document.querySelectorAll('.tab-btn[data-ctab]').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-content[id^="ctab-"]').forEach(tEl => tEl.classList.toggle('hidden', tEl.id !== 'ctab-' + tab));
        if (tab === 'calculators' && typeof window.injectTasPdfButton === 'function') window.injectTasPdfButton();
      }));
    });
  }
  ensureClientTabBindings();
  // Re-run after render cycles (dashboard re-renders may replace markup).
  setInterval(ensureClientTabBindings, 2500);

  // Backstop: if the app boots while a modal is somehow left open, close it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    ['profileEditModal', 'progressModal'].forEach(id => {
      const m = $id(id);
      if (m && !m.classList.contains('hidden')) m.classList.add('hidden');
    });
  });

  // ============================================================
  // 4 · 📄 CALCULATOR PDF REPORT — advanced, professional design
  //     Uses jsPDF (lazy-loaded from CDN on demand). Renders a
  //     branded cover band, KPI tiles, BMI gauge, macros donut,
  //     heart-rate zone bars, full 15-card results grid, progress
  //     trend table + weight/body-fat line charts and a footer.
  // ============================================================
  const JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
  const JSPDF_LOCAL = 'vendor/jspdf.umd.min.js';   // 📦 bundled copy — works offline in the PWA
  let pdfLoading = null;

  window.loadJsPDF = function () {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (pdfLoading) return pdfLoading;
    // Try the locally-bundled engine first (offline/PWA-safe), then the CDN.
    // 🛡️ If a stale service worker serves an HTML error page instead of the
    // local file, window.jspdf will be missing after load — treat that as a
    // failure and fall through to the CDN instead of hanging/throwing later.
    const inject = (src) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error('jsPDF loaded but global missing from ' + src));
      };
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
    pdfLoading = inject(JSPDF_LOCAL)
      .catch(() => inject(JSPDF_CDN))
      .then((ctor) => { pdfLoading = null; return ctor; })
      .catch((err) => { pdfLoading = null; throw new Error('PDF engine could not be loaded (' + (err.message || err) + ')'); });
    return pdfLoading;
  };

  // Brand palette (matches the portal's emerald identity)
  const C = {
    ink: [16, 32, 44], brand: [31, 78, 61], brand2: [56, 130, 106], accent: [24, 199, 146],
    soft: [125, 147, 166], card: [246, 250, 248], line: [222, 232, 227], white: [255, 255, 255],
    red: [231, 76, 60], amber: [241, 196, 15], green: [46, 204, 113], blue: [61, 130, 180],
    violet: [118, 75, 162]
  };

  window.tasGenerateCalcPDF = async function () {
    const btn = $id('calcPdfBtn');
    try {
      const S = window.APP_STATE;
      const c = S && S.loggedInClient;
      if (!c) { showToastSafe('🔐 Sign in first, then generate your report.', 'info'); return; }
      if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Generating…'; }
      const JsPDF = await window.loadJsPDF();

      // ---- gather calculator state (live hub values for this client) ----
      let stats = Object.assign({}, window.__calcDefaults || {
        weight: 75, height: 175, age: 25, gender: 'Male', activity: 'Moderately Active',
        goal: 'Maintain', waist: 85, neck: 38, hip: 95, bench: 80, bodyfat: 15
      });
      const p = (typeof clientMapGet === 'function' && S.clientProfiles)
        ? (clientMapGet(S.clientProfiles, c.id) || {}) : {};
      if (typeof window.profileHasCalcStats === 'function' && window.profileHasCalcStats(p)) {
        Object.assign(stats, window.profileCalcStats(p));
      }
      // 🛡️ The Shared Inputs on 👤 My Profile live in the single merged
      // form rendered by js/progress.js — ids pcx-weight/pcx-height/…
      // (legacy pc*/pcx-* variants kept as fallbacks for cached pages).
      const liveMap = {
        weight: ['pcx-weight', 'pcWeight'], height: ['pcx-height', 'pcHeightCm'],
        age: ['pcx-age', 'pcAge'], gender: ['pcx-gender', 'pcGenderSel'],
        activity: ['pcx-activity', 'pcActivity'], goal: ['pcx-goal', 'pcGoalSel'],
        waist: ['pcx-waist', 'pcWaist'], neck: ['pcx-neck', 'pcNeck'],
        hip: ['pcx-hip', 'pcHip'], bench: ['pcx-bench', 'pcBench'],
        bodyfat: ['pcx-bodyfat', 'pcBodyfat']
      };
      Object.entries(liveMap).forEach(([k, ids]) => {
        let el = null;
        for (const id of ids) { el = $id(id); if (el) break; }
        if (!el) return;
        if (el.tagName === 'SELECT') { if (el.value) stats[k] = el.value; }
        else { const n = parseFloat(el.value); if (Number.isFinite(n)) stats[k] = n; }
      });
      // 🛡️ Never let NaN/empty strings reach the renderer or the math:
      // any stat that isn't a finite number (or known text option) reverts
      // to the safe default.
      Object.keys(stats).forEach(k => {
        if (k === 'gender' || k === 'activity' || k === 'goal') {
          if (typeof stats[k] !== 'string' || !stats[k]) stats[k] = window.__calcDefaults ? window.__calcDefaults[k] : '—';
        } else {
          const n = parseFloat(stats[k]);
          stats[k] = Number.isFinite(n) ? n : (window.__calcDefaults ? window.__calcDefaults[k] : 0);
        }
      });

      const R = computeCalcResults(stats);
      const entries = ((typeof clientMapGet === 'function' && S.progressEntries)
        ? (clientMapGet(S.progressEntries, c.id) || []) : [])
        .slice().sort((a, b) => String(a.entry_date || '').localeCompare(String(b.entry_date || '')));

      // ================= build the document =================
      const doc = new JsPDF({ unit: 'mm', format: 'a4' });
      const PW = 210, PH = 297, M = 14, CW = PW - M * 2;
      let y = 0;

      // 🛡️ Geometry sanitizer — jsPDF 2.5.2 throws "Invalid argument passed to
      // jsPDF.f2 / f3" (the internal float formatters) whenever ANY coordinate
      // or color component is NaN/Infinity, and it rejects RGB colors passed
      // as an ARRAY — they must be spread as separate numbers. Everything
      // below is clamped through nz()/rgb() so no NaN can ever reach jsPDF.
      const nz = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : (d === undefined ? 0 : d); };
      const nzw = (v) => Math.max(0, nz(v, 0));           // widths/heights ≥ 0
      const rgb = (arr) => (Array.isArray(arr) ? arr.map(v => nz(v, 0)) : [nz(arr, 0), nz(arr, 0), nz(arr, 0)]);
      const text = (str, x, yy, size, color, style, align) => {
        doc.setFont('helvetica', style || 'normal');
        doc.setFontSize(nz(size, 8));
        const col = rgb(color);
        doc.setTextColor(col[0], col[1], col[2]);
        doc.text(String(str == null ? '' : str), nz(x), nz(yy), { align: align || 'left' });
      };
      const rect = (x, yy, w, h, fill, r) => {
        w = nzw(w); h = nzw(h);
        if (w <= 0 || h <= 0) return;
        const col = rgb(fill);
        doc.setFillColor(col[0], col[1], col[2]);
        if (r) doc.roundedRect(nz(x), nz(yy), w, h, nz(r, 2), nz(r, 2), 'F');
        else doc.rect(nz(x), nz(yy), w, h, 'F');
      };
      const stroke = (x, yy, w, h, color, lw, r) => {
        w = nzw(w); h = nzw(h);
        if (w <= 0 || h <= 0) return;
        const col = rgb(color);
        doc.setDrawColor(col[0], col[1], col[2]);
        doc.setLineWidth(Math.max(0.1, nz(lw, 0.3)));
        if (r) doc.roundedRect(nz(x), nz(yy), w, h, nz(r, 2), nz(r, 2), 'S');
        else doc.rect(nz(x), nz(yy), w, h, 'S');
      };
      const grad = (x, yy, w, h, from, to) => {
        from = rgb(from); to = rgb(to);
        const steps = Math.max(8, Math.floor(nz(w, 0) * 2));
        const sw = w / steps + 0.15;
        for (let i = 0; i < steps; i++) {
          const k = i / (steps - 1);
          const col = from.map((f, idx) => Math.round(f + (to[idx] - f) * k));
          rect(x + i * (w / steps), yy, sw, h, col);
        }
      };

      // ---------- COVER BAND ----------
      grad(0, 0, PW, 52, [15, 45, 35], [56, 130, 106]);
      // decorative rings
      doc.setDrawColor(255, 255, 255);
      for (let i = 0; i < 3; i++) {
        doc.setLineWidth(0.6 - i * 0.15);
        doc.circle(PW - 18 - i * 7, 10 + i * 4, 12 + i * 8, 'S');
      }
      // TAS badge mark
      rect(M, 12, 18, 18, [255, 255, 255], 4);
      doc.setDrawColor(31, 78, 61); doc.setLineWidth(1.4);
      doc.line(M + 5.5, 18, M + 12.5, 18);
      doc.setFillColor(31, 78, 61);
      doc.roundedRect(M + 3.4, 15.6, 2.6, 4.8, 0.8, 0.8, 'F');
      doc.roundedRect(M + 12, 15.6, 2.6, 4.8, 0.8, 0.8, 'F');
      text('TAS', M + 9, 26.4, 5.4, [31, 78, 61], 'bold', 'center');
      text('TAS PERSONAL TRAINING', M + 23, 17, 12, [255, 255, 255], 'bold');
      text('Fitness Calculator Report — Advanced Analytics', M + 23, 23.5, 8.6, [200, 235, 220], 'normal');
      text('Prepared for: ' + (c.name || c.login_id || 'Client'), M + 23, 31, 9.4, [255, 255, 255], 'bold');
      text('Report date: ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) +
           '   ·   Generated from your live portal data', M + 23, 36.5, 7.6, [190, 225, 208], 'normal');
      y = 60;

      // ---------- SECTION: INPUT SNAPSHOT ----------
      const sectionHead = (label, icon) => {
        rect(M, y - 5.2, 2.2, 6.4, C.accent);
        text(label.toUpperCase(), M + 4.4, y, 10.5, C.brand, 'bold');
        doc.setLineWidth(0.4); doc.setDrawColor(210, 226, 218);
        doc.line(M + 4.4 + doc.getTextWidth(label.toUpperCase()) + 4, y - 1.2, PW - M, y - 1.2);
        y += 7;
      };
      sectionHead('Your Inputs');
      const chips = [
        ['Weight', f1(stats.weight) + ' kg'], ['Height', f1(stats.height) + ' cm'], ['Age', String(stats.age || '—')],
        ['Gender', stats.gender], ['Activity', stats.activity], ['Goal', stats.goal],
        ['Waist', f1(stats.waist) + ' cm'], ['Neck', f1(stats.neck) + ' cm'], ['Hip', f1(stats.hip) + ' cm'],
        ['Bench', f1(stats.bench) + ' kg'], ['Body Fat', stats.bodyfat != null && Number.isFinite(parseFloat(stats.bodyfat)) ? f1(parseFloat(stats.bodyfat)) + ' %' : 'auto']
      ];
      {
        const perRow = 4, chW = (CW - 3 * 3) / perRow, chH = 10;
        chips.forEach((ch, i) => {
          const cx = M + (i % perRow) * (chW + 3), cy = y + Math.floor(i / perRow) * (chH + 2.6);
          rect(cx, cy, chW, chH, C.card, 2);
          stroke(cx, cy, chW, chH, C.line, 0.25, 2);
          text(ch[0].toUpperCase(), cx + 2.4, cy + 3.8, 5.6, C.soft, 'bold');
          text(ch[1], cx + 2.4, cy + 8, 7.6, C.ink, 'bold');
        });
        y += Math.ceil(chips.length / perRow) * (chH + 2.6) + 4;
      }

      // ---------- KPI DASHBOARD ----------
      sectionHead('Key Metrics');
      const kpis = [
        ['BMI', f1(R.bmi), R.bmiCat || '', R.bmiColor],
        ['BODY FAT', Number.isFinite(R.bfShown) ? f1(R.bfShown) + '%' : '—', R.bfSource, C.violet],
        ['IDEAL WT', Number.isFinite(R.ideal) ? f1(R.ideal) + ' kg' : '—', (R.idealDiff >= 0 ? '+' : '') + f1(R.idealDiff) + ' kg vs now', C.blue],
        ['TDEE', i0(R.tdee) + ' kcal', 'Maintenance burn', C.brand2],
        ['CALORIE GOAL', i0(R.calGoal) + ' kcal', stats.goal + ' target', R.calGoalColor],
        ['PROTEIN', Math.round(R.proteinG) + ' g/day', '≈' + Math.round(R.proteinPerMeal) + ' g per meal', C.amber],
        ['WATER', f1(R.waterL) + ' L/day', Math.round(R.waterGlasses) + ' × 250 ml glasses', C.green],
        ['ONE REP MAX', Number.isFinite(R.orm) ? f1(R.orm) + ' kg' : '—', R.strLevel + ' · ' + f2(R.ratio) + '× BW', C.red]
      ];
      {
        const cols = 4, rows = 2, gapX = 3, gapY = 3;
        const kW = (CW - (cols - 1) * gapX) / cols, kH = 24;
        kpis.forEach((k, i) => {
          const kx = M + (i % cols) * (kW + gapX), ky = y + Math.floor(i / cols) * (kH + gapY);
          rect(kx, ky, kW, kH, [252, 253, 252], 2.5);
          stroke(kx, ky, kW, kH, C.line, 0.25, 2.5);
          rect(kx, ky, 1.6, kH, k[3], 0.8);
          text(k[0], kx + 3.6, ky + 5.2, 6, C.soft, 'bold');
          text(k[1], kx + 3.6, ky + 12.6, 11.5, k[3], 'bold');
          text(k[2], kx + 3.6, ky + 18.6, 6.2, C.ink, 'normal');
        });
        y += rows * (kH + gapY) + 5;
      }

      // ---------- BMI GAUGE + MACRO DONUT ----------
      sectionHead('Composition & Nutrition Breakdown');
      {
        const boxH = 44, halfW = (CW - 4) / 2;
        // BMI gauge (left)
        rect(M, y, halfW, boxH, [252, 253, 252], 2.5); stroke(M, y, halfW, boxH, C.line, 0.25, 2.5);
        text('BMI SCALE', M + 4, y + 6, 7, C.soft, 'bold');
        const gx = M + 6, gw = halfW - 12, gy = y + 12;
        const segs = [[0, 18.5, C.blue, 'Underweight'], [18.5, 25, C.green, 'Normal'], [25, 30, C.amber, 'Overweight'], [30, 40, C.red, 'Obese']];
        if (Number.isFinite(R.bmi)) {
          segs.forEach(s => {
            const x0 = gx + (s[0] / 40) * gw, x1 = gx + (Math.min(s[1], 40) / 40) * gw;
            rect(x0, gy, x1 - x0, 7, s[2]);
          });
          stroke(gx, gy, gw, 7, [235, 240, 238], 0.2);
          const px = gx + (Math.min(Math.max(R.bmi, 0), 40) / 40) * gw;
          const ink = rgb(C.ink);
          doc.setFillColor(ink[0], ink[1], ink[2]);
          doc.triangle(nz(px - 2), nz(gy - 2.6), nz(px + 2), nz(gy - 2.6), nz(px), nz(gy + 0.6), 'F');
          text(f1(R.bmi), px, gy - 4.4, 8, C.ink, 'bold', 'center');
        } else {
          text('Enter age/height/weight in 👤 My Profile to compute BMI.', gx, gy + 4, 7, C.soft, 'italic');
        }
        let lx = gx;
        segs.forEach(s => {
          text(s[3], lx + 1, gy + 12.5, 6, C.soft, 'normal');
          lx += (s[1] - s[0]) / 40 * gw;
        });
        text('Healthy range: 18.5 – 24.9  ·  Lean mass ' + f1(R.leanMass) + ' kg  ·  Fat mass ' + f1(R.fatMass) + ' kg',
          M + 4, y + boxH - 4, 6.4, C.ink, 'normal');

        // Macros stacked bar (right)
        const mx = M + halfW + 4;
        rect(mx, y, halfW, boxH, [252, 253, 252], 2.5); stroke(mx, y, halfW, boxH, C.line, 0.25, 2.5);
        text('DAILY MACROS — ' + String(stats.goal).toUpperCase(), mx + 4, y + 6, 7, C.soft, 'bold');
        const mBarX = mx + 6, mBarW = halfW - 12, mBarY = y + 11, mBarH = 12;
        const totalKcal = nz(R.pG * 4 + R.cG * 4 + R.fG * 9, 0) || 1;
        const macroSegs = [['Protein', nzw(R.pG * 4), [245, 87, 108]], ['Carbs', nzw(R.cG * 4), [79, 172, 254]], ['Fat', nzw(R.fG * 9), [246, 211, 101]]];
        let sx = mBarX;
        macroSegs.forEach(m => {
          const wSeg = Math.min((m[1] / totalKcal) * mBarW, Math.max(0, mBarX + mBarW - sx));
          rect(sx, mBarY, wSeg, mBarH, m[2]);
          if (wSeg > 14) text(Math.round(m[1] / totalKcal * 100) + '%', sx + wSeg / 2, mBarY + 7.4, 7, [16, 32, 44], 'bold', 'center');
          sx += wSeg;
        });
        stroke(mBarX, mBarY, mBarW, mBarH, [235, 240, 238], 0.2);
        let my = mBarY + mBarH + 6;
        macroSegs.forEach(m => {
          rect(mx + 6, my - 2.4, 3, 3, m[2], 0.6);
          text(m[0], mx + 11, my, 6.6, C.ink, 'bold');
          text(Math.round(m[1]) + ' kcal  (' + Math.round(m[1] / 4) + ' g protein/carbs · ' + Math.round(m[1] / 9) + ' g fat)',
            mx + 26, my, 6.2, C.soft, 'normal');
          my += 5.4;
        });
        y += boxH + 6;
      }

      // ---------- HEART-RATE ZONES ----------
      if (R.zones && Number.isFinite(R.maxHr) && R.maxHr > 0) {
        sectionHead('Heart Rate Zones — Karvonen Bands');
        const zx = M + 26, zw = CW - 30, zh = 5.2, zg = 1.6;
        const zcolors = [[116, 185, 255], [85, 239, 196], [255, 234, 167], [250, 177, 160], [255, 118, 117]];
        R.zones.forEach((z, i) => {
          const zy = y + i * (zh + zg);
          text(z[0], M + 2, zy + 3.8, 7, C.ink, 'bold');
          rect(zx, zy, zw, zh, [240, 245, 242], 2.4);
          const frac = Math.min(1, nz(z[2] / R.maxHr, 0));
          rect(zx, zy, zw * frac, zh, zcolors[i], 2.4);
          text(z[1] + '–' + z[2] + ' bpm', PW - M - 2, zy + 3.8, 7, C.ink, 'bold', 'right');
        });
        text('Estimated max heart rate: ' + R.maxHr + ' bpm (220 − age ' + stats.age + ')', M + 2, y + 5 * (zh + zg) + 4.6, 6.4, C.soft, 'italic');
        y += 5 * (zh + zg) + 9;
      }

      // ---------- FULL RESULTS GRID (15 calculators) ----------
      if (y > 210) { doc.addPage(); y = M + 4; }
      sectionHead('All 15 Calculators — Full Results');
      {
        const cards = R.cards; // [{icon,title,value,details:[..]}]
        const cols = 2, gapX = 4, gapY = 4;
        const cW = (CW - gapX) / cols, cH = 30;
        cards.forEach((cd, i) => {
          const col = i % cols, row = Math.floor(i / cols);
          const cx = M + col * (cW + gapX);
          let cy = y + row * (cH + gapY);
          if (cy + cH > PH - 16) {
            doc.addPage();
            drawPageChrome(doc, c.name);
            y = M + 4;
            cy = y; // start this card at the top of the new page
          }
          rect(cx, cy, cW, cH, [253, 254, 253], 2.5);
          stroke(cx, cy, cW, cH, C.line, 0.25, 2.5);
          rect(cx, cy, cW, 7.6, cd.color || C.brand, 2.5);
          rect(cx, cy + 4, cW, 3.6, cd.color || C.brand);
          text(cd.title, cx + 3, cy + 5.3, 7.4, [255, 255, 255], 'bold');
          text(cd.value, cx + cW - 3, cy + 5.3, 7.4, [255, 255, 255], 'bold', 'right');
          let dy = cy + 13;
          (cd.details || []).slice(0, 3).forEach(d => {
            const dot = rgb([196, 214, 205]); doc.setFillColor(dot[0], dot[1], dot[2]); doc.circle(cx + 3.6, dy - 1.1, 0.6, 'F');
            text(d, cx + 6, dy, 6.3, C.ink, 'normal');
            dy += 5;
          });
        });
        y += Math.ceil(cards.length / cols) * (cH + gapY) + 4;
      }

      // ---------- PROGRESS TREND ----------
      if (y > 200) { doc.addPage(); drawPageChrome(doc, c.name); y = M + 4; }
      sectionHead('Progress Trend — Approved Entries');
      if (entries.length) {
        // Table
        const headers = ['Date', 'Weight kg', 'Body Fat %', 'Chest cm', 'Waist cm', 'Hips cm', 'Arms cm', 'Thighs cm'];
        const keys = ['entry_date', 'weight_kg', 'body_fat_pct', 'chest_cm', 'waist_cm', 'hips_cm', 'arms_cm', 'thighs_cm'];
        const colW = [30, 20, 20, 20, 20, 20, 20, CW - 150];
        rect(M, y, CW, 7, C.brand, 1.5);
        let hx = M + 2;
        headers.forEach((h, i) => { text(h, hx, y + 4.8, 6.4, [255, 255, 255], 'bold'); hx += colW[i]; });
        y += 7;
        entries.slice(-10).forEach((e, idx) => {
          if (y + 6.5 > PH - 18) { doc.addPage(); drawPageChrome(doc, c.name); y = M + 4; }
          if (idx % 2 === 0) rect(M, y, CW, 6.5, [247, 251, 248]);
          let tx = M + 2;
          keys.forEach((k, i) => {
            const v = e[k];
            text(k === 'entry_date' ? (v || '—') : (v == null ? '—' : String(v)), tx, y + 4.3, 6.4, C.ink, i === 0 ? 'bold' : 'normal');
            tx += colW[i];
          });
          y += 6.5;
        });
        y += 4;

        // Line chart of weight (+ body fat scaled) over entries
        const pts = entries.filter(e => Number.isFinite(parseFloat(e.weight_kg)));
        if (pts.length >= 2) {
          const chW = CW, chH = 40;
          if (y + chH + 12 > PH - 16) { doc.addPage(); drawPageChrome(doc, c.name); y = M + 4; }
          rect(M, y, chW, chH + 10, [253, 254, 253], 2.5); stroke(M, y, chW, chH + 10, C.line, 0.25, 2.5);
          text('WEIGHT TREND (kg)', M + 4, y + 5.5, 6.6, C.soft, 'bold');
          const vals = pts.map(e => parseFloat(e.weight_kg));
          let vMin = Math.min(...vals) - 1, vMax = Math.max(...vals) + 1;
          if (!(vMax > vMin)) vMax = vMin + 1;   // 🛡️ guard divide-by-zero on flat series
          const px0 = M + 12, px1 = M + chW - 6, py0 = y + 12, py1 = y + chH + 4;
          doc.setDrawColor(225, 235, 229); doc.setLineWidth(0.2);
          for (let g = 0; g <= 4; g++) {
            const gyy = py0 + (py1 - py0) * g / 4;
            doc.line(px0, gyy, px1, gyy);
            text(f1(vMax - (vMax - vMin) * g / 4), M + 2, gyy + 1, 5, C.soft, 'normal');
          }
          const X = (i) => px0 + (px1 - px0) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
          const Y = (v) => py1 - (py1 - py0) * ((nz(v, vMin) - vMin) / (vMax - vMin));
          // area fill (🛡️ setGState can throw on some jsPDF builds — guard it)
          const acc = rgb([24, 199, 146]);
          let gstateOk = false;
          try {
            if (typeof doc.GState === 'function') {
              doc.setGState(new doc.GState({ opacity: 0.14 }));
              gstateOk = true;
            }
          } catch (_) { gstateOk = false; }
          doc.setFillColor(acc[0], acc[1], acc[2]);
          const poly = pts.map((e, i) => [X(i), Y(parseFloat(e.weight_kg))]);
          for (let i = 0; i < poly.length - 1; i++) {
            doc.triangle(nz(poly[i][0]), nz(poly[i][1]), nz(poly[i + 1][0]), nz(poly[i + 1][1]), nz(poly[i][0]), nz(py1), 'F');
            doc.triangle(nz(poly[i + 1][0]), nz(poly[i + 1][1]), nz(poly[i + 1][0]), nz(py1), nz(poly[i][0]), nz(py1), 'F');
          }
          if (gstateOk) { try { doc.setGState(new doc.GState({ opacity: 1 })); } catch (_) {} }
          const brandC = rgb(C.brand);
          doc.setDrawColor(brandC[0], brandC[1], brandC[2]); doc.setLineWidth(0.7);
          for (let i = 0; i < poly.length - 1; i++) doc.line(nz(poly[i][0]), nz(poly[i][1]), nz(poly[i + 1][0]), nz(poly[i + 1][1]));
          poly.forEach(pt => { doc.setFillColor(brandC[0], brandC[1], brandC[2]); doc.circle(nz(pt[0]), nz(pt[1]), 1.1, 'F'); });
          text(String(pts[0].entry_date || ''), px0, py1 + 5, 5.2, C.soft, 'normal');
          text(String(pts[pts.length - 1].entry_date || ''), px1, py1 + 5, 5.2, C.soft, 'normal', 'right');
          y += chH + 15;
        }
      } else {
        text('No approved progress entries yet — add them under 📈 Your Progress → ➕ Add Entry.',
          M + 2, y + 4, 7.4, C.soft, 'italic');
        y += 12;
      }

      // ---------- COACH NOTES + DISCLAIMER ----------
      if (y > 240) { doc.addPage(); drawPageChrome(doc, c.name); y = M + 4; }
      sectionHead('Coach Notes');
      {
        const note = (p.goal ? 'Goal: ' + p.goal + '. ' : '') +
          (p.medical_notes ? 'Medical notes: ' + p.medical_notes + '. ' : '') +
          'Keep updating your Shared Inputs in 👤 My Profile — every calculator and this report refresh automatically.';
        rect(M, y, CW, 20, C.card, 2.5); stroke(M, y, CW, 20, C.line, 0.25, 2.5);
        const lines = doc.splitTextToSize(note, CW - 8);
        text(lines.slice(0, 3), M + 4, y + 5.5, 7, C.ink, 'normal');
        y += 24;
      }

      // ---------- FOOTER SIGNATURE BAND ----------
      const fy = PH - 16;
      grad(0, fy, PW, 4, C.brand, C.accent);
      text('TAS Personal Training · Dubai', M, fy + 8, 7, C.brand, 'bold');
      text('Certified coaching: sutariaabhi98@gmail.com · wa.me/971521391505', M, fy + 13, 6.4, C.soft, 'normal');
      text('This report is an estimate-based guide, not medical advice.', PW - M, fy + 8, 6.4, C.soft, 'italic', 'right');

      // page numbers chrome for later pages (🛡️ spread colors, never arrays)
      function drawPageChrome(d, name) {
        const bc = rgb(C.brand);
        d.setFillColor(bc[0], bc[1], bc[2]);
        d.rect(0, 0, PW, 10, 'F');
        d.setFont('helvetica', 'bold'); d.setFontSize(7);
        d.setTextColor(255, 255, 255);
        d.text('TAS PERSONAL TRAINING — FITNESS CALCULATOR REPORT', 14, 6.4);
        d.text(String(name || ''), PW - 14, 6.4, { align: 'right' });
      }
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        if (i > 1) drawPageChrome(doc, c.name);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
        doc.setTextColor(150, 165, 158);
        doc.text('Page ' + i + ' of ' + pages, PW / 2, PH - 4, { align: 'center' });
      }

      const safeName = String(c.name || 'client').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      doc.save('TAS-Calculator-Report-' + safeName + '-' + todayISO() + '.pdf');
      showToastSafe('📄 Professional PDF report generated — check your downloads!', 'success');
    } catch (err) {
      console.error('PDF generation failed:', err);
      const msg = String(err && err.message || err || 'unknown error');
      // Engine-load failures are network-related; everything else is a code
      // issue — don't blame the user's internet connection for it.
      const netIssue = /could not be loaded|Failed to load/i.test(msg);
      showToastSafe('❌ PDF failed: ' + msg + (netIssue ? ' — check your internet connection and retry.' : ''), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '📄 Generate PDF'; }
    }
  };

  // Pure calculation mirror of calculators.js compute() — kept here so the
  // PDF works even if the hub state changed since last render.
  function computeCalcResults(s) {
    const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };
    const w = num(s.weight), h = num(s.height), a = num(s.age);
    const male = s.gender === 'Male';
    const waist = num(s.waist), neck = num(s.neck), hip = num(s.hip), bench = num(s.bench), bfIn = num(s.bodyfat);
    const ACT = { 'Sedentary': 1.2, 'Lightly Active': 1.375, 'Moderately Active': 1.55, 'Very Active': 1.725, 'Extremely Active': 1.9 };
    const WTR = { 'Sedentary': 1.0, 'Lightly Active': 1.1, 'Moderately Active': 1.2, 'Very Active': 1.4, 'Extremely Active': 1.6 };
    const r = {};
    if (w > 0 && h > 0) {
      const m = h / 100; r.bmi = w / (m * m);
      r.bmiCat = r.bmi < 18.5 ? 'Underweight' : r.bmi < 25 ? 'Normal' : r.bmi < 30 ? 'Overweight' : 'Obese';
      r.bmiColor = r.bmi < 18.5 ? C.blue : r.bmi < 25 ? C.green : r.bmi < 30 ? C.amber : C.red;
    }
    let navy = NaN;
    if (h > 0 && w > 0) {
      if (male && waist > neck) navy = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(h)) - 450;
      else if (!male && (waist + hip) > neck) navy = 495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.22100 * Math.log10(h)) - 450;
    }
    r.bfShown = (Number.isFinite(bfIn) && bfIn > 0) ? bfIn : navy;
    r.bfSource = (Number.isFinite(bfIn) && bfIn > 0) ? 'manual entry' : 'US Navy estimate';
    if (Number.isFinite(r.bfShown) && w > 0) { r.fatMass = w * r.bfShown / 100; r.leanMass = w - r.fatMass; }
    if (h > 0) {
      const inches = h / 2.54;
      r.ideal = (male ? 50 : 45.5) + 2.3 * (inches - 60);
      r.idealDiff = w - r.ideal;
    }
    if (w > 0 && h > 0 && a > 0) r.bmr = 10 * w + 6.25 * h - 5 * a + (male ? 5 : -161);
    if (Number.isFinite(r.bmr)) { r.actMult = ACT[s.activity] || 1.55; r.tdee = r.bmr * r.actMult; }
    if (Number.isFinite(r.tdee)) {
      r.calGoal = s.goal === 'Cut' ? r.tdee - 500 : s.goal === 'Bulk' ? r.tdee + 300 : r.tdee;
      r.calGoalColor = s.goal === 'Cut' ? C.red : s.goal === 'Bulk' ? C.green : C.blue;
    }
    if (w > 0) { r.proteinG = w * (s.goal === 'Cut' ? 2.2 : s.goal === 'Bulk' ? 2.0 : 1.6); r.proteinPerMeal = r.proteinG / 4; }
    if (Number.isFinite(r.calGoal)) {
      const pct = s.goal === 'Cut' ? [0.40, 0.30, 0.30] : s.goal === 'Bulk' ? [0.30, 0.45, 0.25] : [0.30, 0.40, 0.30];
      r.pG = r.calGoal * pct[0] / 4; r.cG = r.calGoal * pct[1] / 4; r.fG = r.calGoal * pct[2] / 9;
    }
    if (w > 0) { r.waterL = w * 0.033 * (WTR[s.activity] || 1.2); r.waterGlasses = r.waterL / 0.25; }
    if (bench > 0) {
      r.orm = bench <= 1 ? bench : bench * (1 + bench / 30);
      if (Number.isFinite(r.orm) && w > 0) {
        r.ratio = r.orm / w;
        r.strLevel = r.ratio >= 2 ? 'Elite' : r.ratio >= 1.5 ? 'Advanced' : r.ratio >= 1 ? 'Intermediate' : r.ratio >= 0.75 ? 'Novice' : 'Beginner';
      }
    }
    if (a > 0) {
      r.maxHr = 220 - a;
      r.zones = [['Warm Up', 50, 60], ['Fat Burn', 60, 70], ['Cardio', 70, 80], ['Peak', 80, 90], ['Max Effort', 90, 100]]
        .map(z => [z[0], Math.round(r.maxHr * z[1] / 100), Math.round(r.maxHr * z[2] / 100)]);
    }
    const V = { 'Sedentary': '8–10 sets/week', 'Lightly Active': '10–12 sets/week', 'Moderately Active': '12–16 sets/week', 'Very Active': '16–20 sets/week', 'Extremely Active': '20–24 sets/week' };
    r.volume = V[s.activity] || '12–16 sets/week';
    const fmt = (v, suf) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? i0(v) : f1(v)) + (suf || '') : '—');
    r.cards = [
      { title: 'BMI', value: fmt(r.bmi), color: r.bmiColor, details: ['Category: ' + (r.bmiCat || '—'), 'Height ' + f1(h) + ' cm · Weight ' + f1(w) + ' kg'] },
      { title: 'Body Fat % (US Navy)', value: Number.isFinite(r.bfShown) ? f1(r.bfShown) + '%' : '—', color: C.violet, details: ['Lean mass ' + f1(r.leanMass) + ' kg', 'Fat mass ' + f1(r.fatMass) + ' kg', 'Source: ' + r.bfSource] },
      { title: 'Ideal Weight (Devine)', value: Number.isFinite(r.ideal) ? f1(r.ideal) + ' kg' : '—', color: C.blue, details: ['Current ' + f1(w) + ' kg', (r.idealDiff >= 0 ? 'Above ideal by ' : 'Below ideal by ') + f1(Math.abs(r.idealDiff)) + ' kg'] },
      { title: 'BMR (Mifflin-St Jeor)', value: i0(r.bmr) + ' kcal', color: C.brand2, details: ['Energy at complete rest', male ? '+5 constant (male)' : '−161 constant (female)'] },
      { title: 'TDEE', value: i0(r.tdee) + ' kcal', color: C.accent, details: ['BMR × ' + (r.actMult || 1.55) + ' (' + s.activity + ')', 'Per meal ÷4 ≈ ' + i0((r.tdee || 0) / 4) + ' kcal'] },
      { title: 'Calorie Goal', value: i0(r.calGoal) + ' kcal', color: r.calGoalColor, details: ['Goal: ' + s.goal, 'vs TDEE: ' + (Number.isFinite(r.calGoal) && Number.isFinite(r.tdee) ? (r.calGoal > r.tdee ? '+' : '') + Math.round(r.calGoal - r.tdee) + ' kcal' : '—')] },
      { title: 'Protein Intake', value: Math.round(r.proteinG || 0) + ' g/day', color: C.amber, details: ['Per meal ≈ ' + Math.round(r.proteinPerMeal || 0) + ' g'] },
      { title: 'Macros Split (P/C/F)', value: Number.isFinite(r.pG) ? Math.round(r.pG) + '/' + Math.round(r.cG) + '/' + Math.round(r.fG) + ' g' : '—', color: [245, 87, 108], details: ['Protein ' + i0((r.pG || 0) * 4) + ' kcal', 'Carbs ' + i0((r.cG || 0) * 4) + ' kcal', 'Fat ' + i0((r.fG || 0) * 9) + ' kcal'] },
      { title: 'Water Intake', value: f1(r.waterL) + ' L/day', color: C.green, details: ['≈ ' + Math.round(r.waterGlasses || 0) + ' × 250 ml glasses'] },
      { title: 'One Rep Max (Epley)', value: f1(r.orm) + ' kg', color: C.red, details: ['5RM ≈ ' + f1((r.orm || 0) / (1 + 5 / 30)) + ' kg', '8RM ≈ ' + f1((r.orm || 0) / (1 + 8 / 30)) + ' kg', '12RM ≈ ' + f1((r.orm || 0) / (1 + 12 / 30)) + ' kg'] },
      { title: 'Strength Level', value: r.strLevel || '—', color: C.brand, details: [Number.isFinite(r.ratio) ? f2(r.ratio) + '× bodyweight' : 'Enter bench press', '≥2× Elite · ≥1.5× Adv · ≥1× Inter'] },
      { title: 'Training Volume', value: r.volume, color: [106, 130, 251], details: ['Based on ' + s.activity + ' lifestyle'] },
      { title: 'Max Heart Rate', value: Number.isFinite(r.maxHr) ? r.maxHr + ' bpm' : '—', color: [221, 36, 118], details: r.zones ? r.zones.map(z => z[0] + ': ' + z[1] + '–' + z[2] + ' bpm').slice(0, 3) : [] },
      { title: 'Calories Burned / Session', value: Number.isFinite(r.tdee) ? 'Base ' + i0(r.tdee) + ' kcal' : '—', color: [247, 151, 30], details: ['Light 30 min ≈ ' + i0((r.tdee || 0) * 0.08) + ' kcal', 'HIIT 30 min ≈ ' + i0((r.tdee || 0) * 0.12) + ' kcal', 'Intense 1 hr ≈ ' + i0((r.tdee || 0) * 0.15) + ' kcal'] },
      { title: 'BMI Category Check', value: r.bmiCat || '—', color: r.bmiColor, details: ['Underweight <18.5 · Normal 18.5–24.9', 'Overweight 25–29.9 · Obese ≥30'] }
    ];
    return r;
  }

  // ============================================================
  // 5 · Inject the 📄 Generate PDF button into the Calculators tab
  //     (runs after calculators.js mounts the hub; MutationObserver
  //     keeps it there even if the hub re-renders).
  // ============================================================
  function injectPdfButton() {
    const head = document.querySelector('#ctab-calculators .calc-sticky-head');
    if (!head || head.querySelector('#calcPdfBtn')) return;
    const wrap = document.createElement('div');
    wrap.className = 'calc-pdf-row';
    wrap.innerHTML = '<button type="button" class="btn-calc-pdf" id="calcPdfBtn" title="Download an advanced, professionally designed PDF of all 15 calculators">📄 Generate PDF</button>' +
      '<span class="calc-pdf-hint">Branded multi-page report · charts, KPIs &amp; progress trends</span>';
    head.appendChild(wrap);
  }
  // Exposed so tab-switching (and any late hub re-render) can force a retry.
  window.injectTasPdfButton = injectPdfButton;
  function startInjector() {
    injectPdfButton();
    const target = document.getElementById('ctab-calculators');
    if (target && window.MutationObserver) {
      new MutationObserver(() => injectPdfButton()).observe(target, { childList: true, subtree: true });
    } else {
      setTimeout(injectPdfButton, 1500);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startInjector);
  } else {
    startInjector();
  }
})();
