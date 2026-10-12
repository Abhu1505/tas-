// ============================================================
// FITNESS CALCULATOR HUB — 15 calculators, ONE shared input set
// ------------------------------------------------------------
// Core concept: the "📌 Shared Inputs — entered once, used by all
// 15 calculators" now live inside 👤 My Profile (client portal) and
// are saved to the cloud profile. Every calculator card reads from
// that same state — nothing is typed inside the Calculators tab.
// No calculator has its own input fields.
//
// Exposed for the Profile tab (js/progress.js):
//   window.CALC_SHARED_FIELDS      → the 11 field definitions
//   window.renderCalcSharedInputs()→ builds the shared-inputs panel
//   window.saveCalcSharedInput(id, clientId) → persists one value
//
// Persistence: inputs are saved per client in Supabase table
//   fitness_inputs (client_id unique + inputs jsonb)
// with a localStorage fallback so the hub works offline too.
// Saving is DEBOUNCED (900 ms). If the fitness_inputs table does
// not exist yet (migration not run), saving is silently skipped —
// run sql/fitness_calculator.sql in the Supabase SQL editor once.
//
// Wipe / cascade integration lives here as well:
//   • window.wipeFitnessInputs()          → "Email & Wipe All Data"
//   • window.deleteFitnessInputsFor(id)   → single-client delete cascade
// Both are called from js/wipe.js and js/clients.js and also remove
// the local cached copies so nothing "comes back" after a wipe.
// ============================================================
(function () {
  'use strict';

  // ---------- defaults ----------
  // CLIENTS START EMPTY: every shared input begins blank and the client
  // fills them in under 👤 Profile → ✏️ Edit Profile. The calculator cards
  // show a friendly "fill your profile" hint until enough values exist.
  // (The trainer's 🧮 Calculators workspace can still ↺ Reset to these
  // demo numbers — they are never pre-filled for a client.)
  const DEFAULTS = {
    weight: '', height: '', age: '', gender: 'Male',
    activity: 'Moderately Active', goal: 'Maintain',
    waist: '', neck: '', hip: '', bench: '', bodyfat: ''
  };
  // Demo numbers used ONLY by the admin hub's ↺ Reset button.
  const DEMO_DEFAULTS = {
    weight: 75, height: 175, age: 25, gender: 'Male',
    activity: 'Moderately Active', goal: 'Maintain',
    waist: 85, neck: 38, hip: 95, bench: 80, bodyfat: 15
  };
  const LS_PREFIX = 'tas_fitness_inputs_';           // localStorage fallback key
  const ACTIVITY_MULT = {                            // TDEE multipliers
    'Sedentary': 1.2, 'Lightly Active': 1.375, 'Moderately Active': 1.55,
    'Very Active': 1.725, 'Extremely Active': 1.9
  };
  const WATER_MULT = {                               // water intake multipliers
    'Sedentary': 1.0, 'Lightly Active': 1.1, 'Moderately Active': 1.2,
    'Very Active': 1.4, 'Extremely Active': 1.6
  };
  const FIELDS = [
    ['weight', 'Weight (kg)', 'number', 0.1],
    ['height', 'Height (cm)', 'number', 0.1],
    ['age', 'Age', 'number', 1],
    ['gender', 'Gender', ['Male', 'Female']],
    ['activity', 'Activity Level', ['Sedentary', 'Lightly Active', 'Moderately Active', 'Very Active', 'Extremely Active']],
    ['goal', 'Goal', ['Cut', 'Maintain', 'Bulk']],
    ['waist', 'Waist (cm)', 'number', 0.1],
    ['neck', 'Neck (cm)', 'number', 0.1],
    ['hip', 'Hip (cm)', 'number', 0.1],
    ['bench', 'Bench Press (kg)', 'number', 0.1],
    ['bodyfat', 'Body Fat % (optional)', 'number', 0.1]
  ];

  // ---------- state ----------
  let current = Object.assign({}, DEFAULTS);
  let scopeId = null;        // 'guest' | client uuid | admin override id
  let saveTimer = null;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; }
  function f1(v) { return Number.isFinite(v) ? v.toFixed(1) : '—'; }
  function f2(v) { return Number.isFinite(v) ? v.toFixed(2) : '—'; }
  function i0(v) { return Number.isFinite(v) ? Math.round(v).toLocaleString() : '—'; }

  // ---------- profile body stats (shared with the client Profile tab) ----------
  // The 11 shared inputs are ALSO stored as columns on client_profiles
  // (sql/fitness_calculator.sql). When a profile row carries at least one of
  // them, those approved values become the calculator hub's defaults for that
  // client — so "Edit Profile → Calculator Body Stats" feeds every card.
  const PROFILE_STAT_COLS = {
    weight: 'fit_weight_kg', height: 'fit_height_cm', age: 'fit_age',
    gender: 'fit_gender', activity: 'fit_activity_level', goal: 'fit_goal',
    waist: 'fit_waist_cm', neck: 'fit_neck_cm', hip: 'fit_hip_cm',
    bench: 'fit_bench_kg', bodyfat: 'fit_body_fat_pct'
  };

  window.profileHasCalcStats = function (p) {
    if (!p) return false;
    return Object.values(PROFILE_STAT_COLS).some(k => p[k] !== null && p[k] !== undefined && p[k] !== '');
  };

  window.profileCalcStats = function (p) {
    const out = {};
    Object.entries(PROFILE_STAT_COLS).forEach(([key, col]) => {
      let v = p ? p[col] : null;
      if (v === undefined || v === null || v === '') return;
      if (key === 'gender' || key === 'activity' || key === 'goal') {
        const allowed = FIELDS.find(f => f[0] === key)[2];   // dropdown options
        v = String(v);
        if (!allowed.includes(v)) return;                    // ignore unknown values
      } else {
        v = num(v);
        if (!Number.isFinite(v)) return;
      }
      out[key] = v;
    });
    return out;
  };

  async function mergeProfileStats(clientId, baseInputs) {
    // Fresh read of the approved profile row (works even when the full
    // client_profiles load happened before this feature existed).
    let p = null;
    try {
      const sb = APP_STATE.supabaseClient;
      if (sb) {
        const { data, error } = await sb.from('client_profiles')
          .select('*').eq('client_id', String(clientId)).maybeSingle();
        if (!error && data) p = data;
      }
    } catch (e) { /* missing table/columns → profile stats simply skipped */ }
    if (!p) p = (typeof clientMapGet === 'function' && clientMapGet(APP_STATE.clientProfiles, clientId)) || null;
    return { profile: p, inputs: window.profileHasCalcStats(p)
      ? Object.assign({}, DEFAULTS, window.profileCalcStats(p), baseInputs || {})
      : baseInputs };
  }

  // ---------- cloud/local persistence ----------
  function lsKey(id) { return LS_PREFIX + String(id); }

  // 📌 True while this client has a PENDING profile submission. Used by the
  // approval gate (live typing must NOT flow into the calculator cards until
  // the trainer approves). The authoritative list is APP_STATE.profileApprovals
  // (loaded at boot and refreshed every 60 s by js/notifications.js), plus a
  // lightweight localStorage flag set right after "📩 Save to Profile" so the
  // gate also works between refreshes / offline.
  window.clientProfileApprovalPending = function (clientId) {
    if (!clientId || clientId === 'guest') return false;
    try {
      if (localStorage.getItem('tas_profile_pending:' + String(clientId)) === '1') return true;
    } catch (e) { }
    const S = window.APP_STATE || {};
    return (S.profileApprovals || []).some(a => sameId(a.client_id, clientId) && a.status === 'pending');
  };

  // 📌 APPROVAL GATE — one-time purge of LEGACY draft rows. Older builds
  // autosaved every keystroke from the Profile form into fitness_inputs /
  // localStorage WITHOUT approval. Those unapproved drafts must never show
  // up in the calculators, so on first load we delete any fitness_inputs row
  // whose values don't match the client's APPROVED profile (fit_* columns).
  // Going forward nothing is written to fitness_inputs except by
  // syncFitnessInputsFromProfile() right after a trainer approves.
  const DRAFT_PURGE_FLAG = 'tas_fit_drafts_purged_v1';
  async function purgeUnapprovedDraftRows(clientId) {
    const S = window.APP_STATE || {};
    if (!S.supabaseClient) return;
    let perClientDone = false;
    try {
      perClientDone = !!localStorage.getItem(DRAFT_PURGE_FLAG + ':' + String(clientId));
    } catch (e) { }
    if (perClientDone) return;
    let p = null;
    try {
      const { data } = await S.supabaseClient.from('client_profiles')
        .select('*').eq('client_id', String(clientId)).maybeSingle();
      p = data || null;
    } catch (e) { return; }               // table/columns missing → nothing to compare
    const approved = (p && window.profileHasCalcStats(p)) ? window.profileCalcStats(p) : {};
    try {
      const { data: row } = await S.supabaseClient.from('fitness_inputs')
        .select('id, inputs').eq('client_id', String(clientId)).maybeSingle();
      if (row) {
        const ins = row.inputs || {};
        const numericKeys = ['weight', 'height', 'age', 'waist', 'neck', 'hip', 'bench', 'bodyfat'];
        const differs = numericKeys.some(k => {
          const a = parseFloat(approved[k]), i = parseFloat(ins[k]);
          if (!Number.isFinite(i)) return false;       // blank draft entry → harmless
          return !Number.isFinite(a) || Math.abs(a - i) > 0.001;
        });
        if (differs) {
          await S.supabaseClient.from('fitness_inputs').delete().eq('id', row.id);
        } else if (!differs && Object.keys(approved).length) {
          // Row matches the approved profile → keep it as the synced cache.
        }
      }
    } catch (e) { /* table missing → nothing to purge */ }
    try { localStorage.setItem(DRAFT_PURGE_FLAG + ':' + String(clientId), '1'); } catch (e) { }
  }

  window.loadFitnessInputsFor = async function (clientId) {
    scopeId = clientId || 'guest';
    let loaded = null;
    let prof = null;
    if (clientId && clientId !== 'guest') {
      // 🔄 Self-heal the local "pending" gate flag against the authoritative
      // profile_approvals list: cleared on approve/reject, but a trainer who
      // decided from ANOTHER device never clears this browser's copy. Without
      // this check the client's live typing would stay blocked forever after
      // an approval that happened elsewhere.
      try {
        const pendFlag = 'tas_profile_pending:' + String(clientId);
        if (localStorage.getItem(pendFlag) === '1' && APP_STATE.supabaseClient) {
          const { data: pendRow } = await APP_STATE.supabaseClient.from('profile_approvals')
            .select('status').eq('client_id', String(clientId)).eq('status', 'pending')
            .order('submitted_at', { ascending: false }).limit(1).maybeSingle();
          if (!pendRow) localStorage.removeItem(pendFlag);
        }
      } catch (e) { /* offline — keep the local flag as-is */ }
      // 📌 APPROVED-ONLY: the hub never adopts unapproved drafts from
      // fitness_inputs or localStorage. The single source of truth for a
      // client's calculator values is their APPROVED profile (client_profiles
      // fit_* columns, written by js/approvals.js when the trainer approves).
      // Legacy fitness_inputs rows that contain UNAPPROVED draft values are
      // purged below so stale numbers can never "come back"; approved values
      // are re-synced into that table by syncFitnessInputsFromProfile().
      try { await purgeUnapprovedDraftRows(clientId); } catch (e) { /* offline */ }
      // Approved profile body stats are the ONLY values loaded for a client.
      const merged = await mergeProfileStats(clientId, {});
      loaded = merged.inputs;
      prof = merged.profile;
      // Keep the local cache in step with the approved values (offline view).
      if (prof && window.profileHasCalcStats(prof)) {
        try { localStorage.setItem(lsKey(clientId), JSON.stringify(loaded || {})); } catch (e) { }
      } else {
        try { localStorage.removeItem(lsKey(clientId)); } catch (e) { }
      }
    }
    current = Object.assign({}, DEFAULTS, loaded || {});
    renderInputs();
    renderCards();
    // Small badge telling the user whether these values came from their
    // approved Profile → Shared Inputs or from the saved inputs themselves.
    try {
      const fromProfile = !!(prof && window.profileHasCalcStats(prof));
      document.querySelectorAll('.calc-profile-note').forEach(n => {
        n.textContent = fromProfile ? '· synced from client Profile ✓' : '';
        n.classList.toggle('hidden', !fromProfile);
      });
      document.querySelectorAll('#profileSharedNote').forEach(n => {
        n.textContent = fromProfile ? '· saved to your cloud profile ✓' : '';
        n.classList.toggle('hidden', !fromProfile);
      });
    } catch (e) { }
  };

  function persist() {
    // Never auto-save demo/guest state into a real client's row — this also
    // closes a race where an old debounce timer fired AFTER logout/wipe and
    // resurrected numbers for a client whose data was just cleared.
    if (scopeId === 'guest' || !scopeId) {
      try { localStorage.setItem(lsKey('guest'), JSON.stringify(current)); } catch (e) { }
      return;
    }
    const S = window.APP_STATE || {};
    const isOwnClient = S.loggedInClient && String(S.loggedInClient.id) === String(scopeId);
    const isSelectedClient = !!S.selectedClientId && String(S.selectedClientId) === String(scopeId);
    if (!isOwnClient && !isSelectedClient) return;
    // Always keep a local copy (offline-safe, instant restore).
    try { localStorage.setItem(lsKey(scopeId), JSON.stringify(current)); } catch (e) { }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const sb = APP_STATE.supabaseClient;
        if (!sb) return;
        const { error } = await sb.from('fitness_inputs').upsert(
          { client_id: scopeId, inputs: current, updated_at: new Date().toISOString() },
          { onConflict: 'client_id' });
        // Missing table (migration not run yet) or transient error → silent skip.
        if (error) console.debug('fitness_inputs save skipped:', error.message);
      } catch (e) { /* never break real-time UX on a network hiccup */ }
    }, 900);
  }

  // Called by the global wipe (js/wipe.js) — removes all saved calculator data.
  window.wipeFitnessInputs = async function () {
    try { await APP_STATE.supabaseClient.from('fitness_inputs').delete().gt('id', 0); }
    catch (e) {
      try { await APP_STATE.supabaseClient.from('fitness_inputs').delete().gt('id', '00000000-0000-0000-0000-000000000000'); }
      catch (e2) { console.warn('wipe: fitness_inputs skipped', e2); }
    }
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
      }
    } catch (e) { }
  };

  // Called by js/approvals.js right after a trainer approves profile edits:
  // copies the approved fit_* profile columns into this client's saved
  // calculator inputs so the Calculators tab reflects them instantly.
  window.syncFitnessInputsFromProfile = async function (clientId) {
    if (!clientId || clientId === 'guest') return;
    let p = null;
    try {
      const sb = APP_STATE.supabaseClient;
      if (sb) {
        const { data } = await sb.from('client_profiles')
          .select('*').eq('client_id', String(clientId)).maybeSingle();
        p = data || null;
      }
    } catch (e) { /* migration not run — nothing to sync */ }
    // 🔄 Freshness guard: when called right after a trainer approval, the
    // in-memory cache was just updated by js/approvals.js but the cloud read
    // above may race / fail. If the local copy carries approved fit_* stats
    // that the fresh row lacks, prefer the local (just-approved) copy.
    try {
      const localP = (typeof clientMapGet === 'function' && clientMapGet(APP_STATE.clientProfiles, clientId)) || null;
      if (localP && window.profileHasCalcStats(localP) &&
          (!p || !window.profileHasCalcStats(p))) p = localP;
    } catch (e) { }
    if (!p) p = (typeof clientMapGet === 'function' && clientMapGet(APP_STATE.clientProfiles, clientId)) || null;
    if (!p || !window.profileHasCalcStats(p)) return;
    const stats = window.profileCalcStats(p);
    // 📌 APPROVED VALUES WIN: the sync OVERWRITES (not merges) the numeric
    // body stats so unapproved draft leftovers from older builds can never
    // survive in fitness_inputs / localStorage. Text fields fall back to the
    // approved profile too; anything missing reverts to the empty default.
    let existing = null;   // legacy drafts are intentionally NOT adopted
    const merged = Object.assign({}, DEFAULTS, stats);
    try { localStorage.setItem(lsKey(String(clientId)), JSON.stringify(merged)); } catch (e) { }
    try {
      const sb = APP_STATE.supabaseClient;
      if (sb) {
        await sb.from('fitness_inputs').upsert(
          { client_id: String(clientId), inputs: merged, updated_at: new Date().toISOString() },
          { onConflict: 'client_id' });
      }
    } catch (e) { /* table missing → local copy still updated */ }
    if (String(scopeId) === String(clientId)) {
      current = merged;
      renderInputs();
      renderCards();
    }
  };

  // Called by the per-client delete cascade (js/clients.js).
  window.deleteFitnessInputsFor = async function (clientId, loginId) {
    const del = async (val) => {
      try { await APP_STATE.supabaseClient.from('fitness_inputs').delete().eq('client_id', val); }
      catch (e) { console.warn('delete client: fitness_inputs skipped', e); }
    };
    await del(clientId);
    if (loginId && String(loginId) !== String(clientId)) await del(loginId);
    try { localStorage.removeItem(lsKey(clientId)); } catch (e) { }
  };

  // ---------- shared input panel ----------
  // Placeholders show the demo numbers only as faint hints — the fields
  // themselves start EMPTY so every client enters their own details.
  function inputHtml(key, label, type, step, value) {
    const id = 'fitIn-' + key;
    let control;
    if (Array.isArray(type)) {
      control = `<select class="calc-input" id="${id}" data-fitkey="${key}">` +
        type.map(o => `<option${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('') + '</select>';
    } else {
      const ph = DEMO_DEFAULTS[key];
      const v = (value === null || value === undefined || value === '' || !Number.isFinite(num(value)))
        ? '' : esc(value);
      control = `<input class="calc-input" type="number" id="${id}" data-fitkey="${key}" step="${step}" min="0" inputmode="decimal" placeholder="${ph}" value="${v}">`;
    }
    return `<div class="input-group calc-field"><label for="${id}">${esc(label)}</label>${control}</div>`;
  }

  // ---------- shared inputs — rendered inside 👤 My Profile ----------
  // The panel builder is exposed so the Profile tab (js/progress.js) can
  // mount the exact same "📌 Shared Inputs" grid calculators used before.
  window.CALC_SHARED_FIELDS = FIELDS;

  window.renderCalcSharedInputs = function () {
    document.querySelectorAll('.calc-shared-inputs').forEach(box => {
      const scopeAttr = box.dataset.calcscope || '';
      box.innerHTML = FIELDS.map(f => {
        let html = inputHtml(f[0], f[1], f[2], f[3], current[f[0]]);
        if (scopeAttr) {
          html = html.replace('class="input-group calc-field"',
            `class="input-group calc-field" data-calcscope="${esc(scopeAttr)}"`);
        }
        return html;
      }).join('');
    });
  };

  // Persist ONE shared input straight from the Profile fields (used when
  // the client edits their profile but the hub state hasn't been loaded
  // for them yet, e.g. right after login on a fresh page).
  window.saveCalcSharedInput = async function (id, clientId) {
    if (!clientId || clientId === 'guest') return;
    const el = $(id);
    if (!el) return;
    const def = FIELDS.find(f => 'fitIn-' + f[0] === id);
    if (!def) return;
    let existing = null;
    try {
      const raw = localStorage.getItem(lsKey(clientId));
      if (raw) existing = JSON.parse(raw);
    } catch (e) { }
    const merged = Object.assign({}, DEFAULTS, existing || {});
    merged[def[0]] = Array.isArray(def[2]) ? el.value : num(el.value);
    try { localStorage.setItem(lsKey(clientId), JSON.stringify(merged)); } catch (e) { }
    try {
      const sb = APP_STATE.supabaseClient;
      if (sb) {
        await sb.from('fitness_inputs').upsert(
          { client_id: String(clientId), inputs: merged, updated_at: new Date().toISOString() },
          { onConflict: 'client_id' });
      }
    } catch (e) { /* table missing → local copy still saved */ }
    if (String(scopeId) === String(clientId)) {
      current = merged;
      window.renderCalcSharedInputs();
      renderCards();
    }
  };

  function renderInputs() {
    window.renderCalcSharedInputs();
  }

  // "↺ Reset" — admin hub only. Restores the demo numbers so a trainer can
  // preview the calculators quickly (clients never see this button).
  window.resetFitnessInputs = function () {
    current = Object.assign({}, DEFAULTS, DEMO_DEFAULTS);
    renderInputs();
    renderCards();
    persist();
  };

  // Single delegated listener: ANY shared input change updates ALL cards live.
  // The inputs themselves now live in 👤 My Profile (client) / the trainer's
  // Calculators workspace — the scope attribute on each field decides whether
  // a keystroke is adopted into the calculator state.
  function onInput(e) {
    const el = e.target.closest ? e.target.closest('[data-fitkey]') : null;
    if (!el) return;
    if (el.dataset.calcscope === 'client' && !window.APP_STATE?.loggedInClient) return;
    // 📌 APPROVAL GATE: while a client profile submission is PENDING, the
    // cards must keep showing the last APPROVED numbers — typing in the
    // Profile form only PREVIEWs once there is no pending approval (or for
    // the trainer's own admin workspace). Without this guard, unapproved
    // keystrokes would instantly flow into all 15 calculator cards.
    if (el.dataset.calcscope === 'client' && window.clientProfileApprovalPending
        && window.clientProfileApprovalPending(APP_STATE.loggedInClient.id)) return;
    const key = el.dataset.fitkey;
    const def = FIELDS.find(f => f[0] === key);
    if (!def) return;
    current[key] = Array.isArray(def[2]) ? el.value : (num(el.value));
    renderCards();
    persist();
  }

  // ---------- calculation engine (pure functions of `current`) ----------
  function compute() {
    const w = num(current.weight), h = num(current.height), a = num(current.age);
    const male = current.gender === 'Male';
    const waist = num(current.waist), neck = num(current.neck), hip = num(current.hip);
    const bench = num(current.bench), bfIn = num(current.bodyfat);
    const act = current.activity, goal = current.goal;
    const r = {};

    // 1 · BMI
    if (w > 0 && h > 0) {
      const m = h / 100;
      r.bmi = w / (m * m);
      r.bmiCat = r.bmi < 18.5 ? 'Underweight' : r.bmi < 25 ? 'Normal' : r.bmi < 30 ? 'Overweight' : 'Obese';
      r.bmiColor = r.bmi < 18.5 ? '#3d82b4' : r.bmi < 25 ? '#2ecc71' : r.bmi < 30 ? '#f1c40f' : '#e74c3c';
    }

    // 2 · Body Fat % — US Navy method
    let bfNavy = NaN;
    if (h > 0 && w > 0) {
      if (male && waist > neck) {
        bfNavy = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(h)) - 450;
      } else if (!male && (waist + hip) > neck) {
        bfNavy = 495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.22100 * Math.log10(h)) - 450;
      }
    }
    r.bfNavy = bfNavy;
    r.bfShown = Number.isFinite(bfIn) && bfIn > 0 ? bfIn : bfNavy;   // optional manual input wins
    r.bfSource = (Number.isFinite(bfIn) && bfIn > 0) ? 'manual entry' : 'Navy estimate';
    if (Number.isFinite(r.bfShown) && w > 0) {
      r.fatMass = w * r.bfShown / 100;
      r.leanMass = w - r.fatMass;
    }

    // 3 · Ideal Weight — Devine formula
    if (h > 0) {
      const inches = h / 2.54;
      if (inches > 60) {
        r.ideal = (male ? 50 : 45.5) + 2.3 * (inches - 60);
        r.idealNote = '';
      } else {
        r.ideal = (male ? 50 : 45.5) + 2.3 * (inches - 60); // formula applied literally
        r.idealNote = 'formula extrapolated below 5\u2032';
      }
      r.idealDiff = w - r.ideal;   // + over ideal / − under ideal
    }

    // 4 · BMR — Mifflin-St Jeor
    if (w > 0 && h > 0 && a > 0) {
      r.bmr = 10 * w + 6.25 * h - 5 * a + (male ? 5 : -161);
    }
    // 5 · TDEE
    if (Number.isFinite(r.bmr)) {
      r.actMult = ACTIVITY_MULT[act] || 1.55;
      r.tdee = r.bmr * r.actMult;
      r.perMealTdee = r.tdee / 4;
    }
    // 6 · Calorie Goal
    if (Number.isFinite(r.tdee)) {
      r.calGoal = goal === 'Cut' ? r.tdee - 500 : goal === 'Bulk' ? r.tdee + 300 : r.tdee;
      r.calDelta = r.calGoal - r.tdee;
    }
    // 7 · Protein
    if (w > 0) {
      r.proteinG = w * (goal === 'Cut' ? 2.2 : goal === 'Bulk' ? 2.0 : 1.6);
      r.proteinPerMeal = r.proteinG / 4;
    }
    // 8 · Macros split
    if (Number.isFinite(r.calGoal)) {
      const pct = goal === 'Cut' ? [0.40, 0.30, 0.30] : goal === 'Bulk' ? [0.30, 0.45, 0.25] : [0.30, 0.40, 0.30];
      r.macroPct = pct;
      r.pG = r.calGoal * pct[0] / 4;
      r.cG = r.calGoal * pct[1] / 4;
      r.fG = r.calGoal * pct[2] / 9;
    }
    // 9 · Water
    if (w > 0) {
      r.waterL = w * 0.033 * (WATER_MULT[act] || 1.2);
      r.waterGlasses = r.waterL / 0.25;
    }
    // 10 · One Rep Max — Epley
    if (bench > 0) {
      r.orm = bench <= 1 ? bench : bench * (1 + bench / 30);
      // Bench is a WEIGHT (kg): rep estimates use load × (1 + reps/30) solved
      // for the load, i.e. load = 1RM ÷ (1 + reps/30).
      r.rep5 = r.orm / (1 + 5 / 30);
      r.rep8 = r.orm / (1 + 8 / 30);
      r.rep10 = r.orm / (1 + 10 / 30);
      r.rep12 = r.orm / (1 + 12 / 30);
    }
    // 11 · Strength Level (1RM ÷ bodyweight)
    if (Number.isFinite(r.orm) && w > 0) {
      r.ratio = r.orm / w;
      r.strLevel = r.ratio >= 2 ? 'Elite' : r.ratio >= 1.5 ? 'Advanced' : r.ratio >= 1 ? 'Intermediate' : r.ratio >= 0.75 ? 'Novice' : 'Beginner';
      r.strColor = r.ratio >= 2 ? '#e74c3c' : r.ratio >= 1.5 ? '#e67e22' : r.ratio >= 1 ? '#f1c40f' : r.ratio >= 0.75 ? '#3d82b4' : '#2ecc71';
    }
    // 12 · Training Volume
    r.volume = {
      'Sedentary': ['8–10 sets/week', '2 sessions/week', '5 rest days'],
      'Lightly Active': ['10–12 sets/week', '3 sessions/week', '4 rest days'],
      'Moderately Active': ['12–16 sets/week', '4 sessions/week', '3 rest days'],
      'Very Active': ['16–20 sets/week', '5 sessions/week', '2 rest days'],
      'Extremely Active': ['20–24 sets/week', '6 sessions/week', '1 rest day']
    }[act] || ['12–16 sets/week', '4 sessions/week', '3 rest days'];
    // 13 · Heart Rate Zones — Karvonen bands (50–100% of max HR)
    if (a > 0) {
      r.maxHr = 220 - a;
      r.zones = [['Warm Up', 50, 60], ['Fat Burn', 60, 70], ['Cardio', 70, 80], ['Peak', 80, 90], ['Max Effort', 90, 100]]
        .map(z => [z[0], Math.round(r.maxHr * z[1] / 100), Math.round(r.maxHr * z[2] / 100)]);
    }
    // 14 · Calories Burned (share of daily TDEE spent training)
    if (Number.isFinite(r.tdee)) {
      r.burn = [
        ['🚶 Light · 30 min', 0.08], ['🏋️ Intense · 1 hr', 0.15],
        ['⚡ HIIT · 30 min', 0.12], ['🏃 Cardio · 1 hr', 0.18]
      ].map(x => [x[0], Math.round(r.tdee * x[1])]);
    }
    return r;
  }

  // Exposed for the 📈 Progress tab "Key Metrics" panel (js/insights.js):
  // computes ALL 15 calculator results from ANY input set — used with the
  // client's APPROVED profile stats so every reflected result is visible
  // in one place. Returns null when no numbers exist yet.
  window.computeFitnessResults = function (inputs) {
    const snapshot = current;
    try {
      current = Object.assign({}, DEFAULTS, inputs || {});
      if (inputsEmpty()) return null;
      return compute();
    } catch (e) {
      console.warn('computeFitnessResults:', e);
      return null;
    } finally {
      current = snapshot;   // never disturb the live hub state
    }
  };

  // ---------- card rendering ----------
  function bar(pct, color) {
    const p = Math.max(0, Math.min(100, pct));
    return `<div class="calc-bar"><div class="calc-bar-fill" style="width:${p}%;background:${color};"></div></div>`;
  }

  // True when the loaded person has not entered any numbers yet — the
  // cards then show a friendly "fill your profile" note instead of dashes.
  function inputsEmpty() {
    return [current.weight, current.height, current.age, current.waist,
    current.neck, current.hip, current.bench, current.bodyfat]
      .every(v => !Number.isFinite(num(v)));
  }

  function renderCards() {
    const r = compute();
    document.querySelectorAll('.calc-grid').forEach(grid => {
      const scope = grid.dataset.calcscope || 'client';
      if (scope !== 'admin' && inputsEmpty()) {
        grid.innerHTML = `<div class="calc-empty-cta">
          <div class="calc-empty-icon">🧮</div>
          <div class="calc-empty-title">Your calculators are ready — but you haven't entered your details yet.</div>
          <div class="calc-empty-text">Open <strong>👤 Profile → ✏️ Edit Profile → 📌 Shared Inputs</strong>, fill in your Weight, Height, Age and measurements and press <strong>Save to Profile</strong>. All 15 calculators light up instantly.</div>
          <button type="button" class="btn-green-small calc-empty-btn js-goto-profile-edit">✏️ Edit My Profile</button>
        </div>`;
        return;
      }
      grid.innerHTML = CARDS.map(c => c(r, scope)).join('');
    });
  }

  function card(opts) {
    return `<article class="calc-card">
      <div class="calc-icon" style="background:${opts.g};">${opts.i}</div>
      <div class="calc-body">
        <div class="calc-title">${opts.t}</div>
        <div class="calc-subtitle">${opts.s}</div>
        <div class="calc-result"${opts.rc ? ` style="color:${opts.rc}"` : ''}>${opts.v}</div>
        ${opts.extra || ''}
        <div class="calc-details">${opts.d || ''}</div>
      </div>
    </article>`;
  }

  const CARDS = [
    // ---- CATEGORY 1: BODY METRICS ----
    r => card({
      g: 'linear-gradient(135deg,#667eea,#764ba2)', i: '⚖️', t: 'BMI Calculator', s: 'Body Mass Index',
      v: f1(r.bmi), rc: r.bmiColor,
      extra: Number.isFinite(r.bmi) ? bar((r.bmi / 40) * 100, r.bmiColor) : '',
      d: Number.isFinite(r.bmi)
        ? `<span class="pill" style="background:${r.bmiColor}22;color:${r.bmiColor};border:1px solid ${r.bmiColor}55;">${r.bmiCat}</span>
           <span class="calc-detail-item">Height <strong>${f1(num(current.height))} cm</strong></span>
           <span class="calc-detail-item">Weight <strong>${f1(num(current.weight))} kg</strong></span>` : ''
    }),
    r => card({
      g: 'linear-gradient(135deg,#f093fb,#f5576c)', i: '📊', t: 'Body Fat %', s: 'US Navy Method',
      v: Number.isFinite(r.bfShown) ? f1(r.bfShown) + '%' : '—',
      d: Number.isFinite(r.bfShown)
        ? `<span class="calc-detail-item">Lean mass <strong>${f1(r.leanMass)} kg</strong></span>
           <span class="calc-detail-item">Fat mass <strong>${f1(r.fatMass)} kg</strong></span>
           <span class="calc-detail-item">Source <strong>${r.bfSource}</strong></span>`
        : '<span class="calc-detail-item">Enter valid waist / neck (and hip for women) measurements</span>'
    }),
    r => card({
      g: 'linear-gradient(135deg,#4facfe,#00f2fe)', i: '🎯', t: 'Ideal Weight', s: 'Devine Formula',
      v: Number.isFinite(r.ideal) ? f1(r.ideal) + ' kg' : '—',
      d: Number.isFinite(r.ideal)
        ? `<span class="calc-detail-item">Current <strong>${f1(num(current.weight))} kg</strong></span>
           <span class="calc-detail-item">${r.idealDiff >= 0 ? 'Above ideal by' : 'Below ideal by'} <strong>${f1(Math.abs(r.idealDiff))} kg</strong></span>
           ${r.idealNote ? `<span class="calc-detail-item muted">${r.idealNote}</span>` : ''}` : ''
    }),

    // ---- CATEGORY 2: NUTRITION ----
    r => card({
      g: 'linear-gradient(135deg,#fa709a,#fee140)', i: '🔥', t: 'BMR', s: 'Mifflin-St Jeor Equation',
      v: i0(r.bmr) + ' kcal',
      d: Number.isFinite(r.bmr)
        ? `<span class="calc-detail-item">At complete rest</span>
           <span class="calc-detail-item">${current.gender === 'Male' ? '+5 constant' : '−161 constant'}</span>` : ''
    }),
    r => card({
      g: 'linear-gradient(135deg,#30cfd0,#330867)', i: '⚡', t: 'TDEE', s: 'Total Daily Energy Expenditure',
      v: i0(r.tdee) + ' kcal',
      d: Number.isFinite(r.tdee)
        ? `<span class="calc-detail-item">BMR <strong>${i0(r.bmr)}</strong> × <strong>${r.actMult}</strong></span>
           <span class="calc-detail-item">Per meal (÷4) <strong>${i0(r.perMealTdee)} kcal</strong></span>` : ''
    }),
    r => card({
      g: 'linear-gradient(135deg,#a8ff78,#78ffd6)', i: '🍽️', t: 'Calorie Goal', s: `${current.goal} · TDEE ± adjustment`,
      v: i0(r.calGoal) + ' kcal',
      rc: current.goal === 'Cut' ? '#f5576c' : current.goal === 'Bulk' ? '#43e97b' : '#4facfe',
      d: Number.isFinite(r.calGoal)
        ? `<span class="calc-detail-item">${r.calDelta === 0 ? 'Eat at maintenance' : (r.calDelta > 0 ? '+' : '') + Math.round(r.calDelta) + ' kcal vs TDEE'}</span>
           <span class="calc-detail-item">Per meal <strong>${i0(r.calGoal / 4)} kcal</strong></span>` : ''
    }),
    r => card({
      g: 'linear-gradient(135deg,#ff9a9e,#fecfef)', i: '🥩', t: 'Protein Intake', s: `${current.goal}: ${current.goal === 'Cut' ? '2.2' : current.goal === 'Bulk' ? '2.0' : '1.6'} g per kg`,
      v: Number.isFinite(r.proteinG) ? Math.round(r.proteinG) + ' g/day' : '—',
      d: Number.isFinite(r.proteinG)
        ? `<span class="calc-detail-item">Per meal (÷4) <strong>${Math.round(r.proteinPerMeal)} g</strong></span>
           <span class="calc-detail-item">≈ <strong>${(r.proteinG / 28).toFixed(1)}</strong> chicken breasts/wk equiv.</span>` : ''
    }),
    r => card({
      g: 'linear-gradient(135deg,#fad0c4,#ffd1ff)', i: '🧮', t: 'Macros Split', s: `${current.goal} · P/C/F`,
      v: Number.isFinite(r.pG) ? `${Math.round(r.pG)} / ${Math.round(r.cG)} / ${Math.round(r.fG)} g` : '—',
      extra: Number.isFinite(r.pG) ? `<div class="macro-track">
          <div class="macro-seg" style="flex:${r.macroPct[0]};background:#f5576c;">P ${Math.round(r.macroPct[0] * 100)}%</div>
          <div class="macro-seg" style="flex:${r.macroPct[1]};background:#4facfe;">C ${Math.round(r.macroPct[1] * 100)}%</div>
          <div class="macro-seg" style="flex:${r.macroPct[2]};background:#f6d365;">F ${Math.round(r.macroPct[2] * 100)}%</div>
        </div>` : '',
      d: Number.isFinite(r.pG)
        ? `<span class="calc-detail-item">Protein <strong>${i0(r.pG * 4)} kcal</strong></span>
           <span class="calc-detail-item">Carbs <strong>${i0(r.cG * 4)} kcal</strong></span>
           <span class="calc-detail-item">Fat <strong>${i0(r.fG * 9)} kcal</strong></span>` : ''
    }),
    r => card({
      g: 'linear-gradient(135deg,#89f7fe,#66a6ff)', i: '💧', t: 'Water Intake', s: 'Weight × 0.033 L × activity',
      v: Number.isFinite(r.waterL) ? f1(r.waterL) + ' L/day' : '—',
      d: Number.isFinite(r.waterL)
        ? `<span class="calc-detail-item">≈ <strong>${Math.round(r.waterGlasses)}</strong> × 250 ml glasses</span>
           <span class="calc-detail-item">${current.activity} × <strong>${WATER_MULT[current.activity] || 1.2}</strong></span>` : ''
    }),

    // ---- CATEGORY 3: STRENGTH ----
    r => card({
      g: 'linear-gradient(135deg,#f8360f,#f9d423)', i: '🏋️', t: 'One Rep Max', s: 'Epley Formula',
      v: Number.isFinite(r.orm) ? f1(r.orm) + ' kg' : '—',
      d: Number.isFinite(r.orm)
        ? `<span class="calc-detail-item">×5 reps <strong>${f1(r.rep5)} kg</strong></span>
           <span class="calc-detail-item">×8 reps <strong>${f1(r.rep8)} kg</strong></span>
           <span class="calc-detail-item">×10 reps <strong>${f1(r.rep10)} kg</strong></span>
           <span class="calc-detail-item">×12 reps <strong>${f1(r.rep12)} kg</strong></span>` : ''
    }),
    r => card({
      g: 'linear-gradient(135deg,#11998e,#38ef7d)', i: '💪', t: 'Strength Level', s: '1RM ÷ bodyweight',
      v: r.strLevel || '—', rc: r.strColor,
      extra: Number.isFinite(r.ratio) ? bar((r.ratio / 2) * 100, r.strColor) : '',
      d: Number.isFinite(r.ratio)
        ? `<span class="pill" style="background:${r.strColor}22;color:${r.strColor};border:1px solid ${r.strColor}55;">${f2(r.ratio)}× BW</span>
           <span class="calc-detail-item">≥2× Elite · ≥1.5× Adv · ≥1× Inter · ≥0.75× Novice</span>` : ''
    }),
    r => card({
      g: 'linear-gradient(135deg,#fc5c7d,#6a82fb)', i: '📅', t: 'Training Volume', s: `${current.activity} recommendation`,
      v: r.volume[0],
      d: `<span class="calc-detail-item">Sessions <strong>${r.volume[1]}</strong></span>
          <span class="calc-detail-item">Recovery <strong>${r.volume[2]}</strong></span>`
    }),

    // ---- CATEGORY 4: HEALTH ----
    r => card({
      g: 'linear-gradient(135deg,#ff512f,#dd2476)', i: '❤️', t: 'Heart Rate Zones', s: 'Karvonen Method · 220 − age',
      v: Number.isFinite(r.maxHr) ? r.maxHr + ' bpm max' : '—',
      extra: Number.isFinite(r.maxHr) ? `<div class="hr-zones">${r.zones.map((z, i) => {
        const colors = ['#74b9ff', '#55efc4', '#ffeaa7', '#fab1a0', '#ff7675'];
        return `<div class="hr-zone"><span class="hz-dot" style="background:${colors[i]}"></span><span class="hz-name">${z[0]}</span><span class="hz-range">${z[1]}–${z[2]} bpm</span></div>`;
      }).join('')}</div>` : '',
      d: Number.isFinite(r.maxHr) ? `<span class="calc-detail-item">Age <strong>${i0(num(current.age))}</strong></span>` : ''
    }),
    r => card({
      g: 'linear-gradient(135deg,#f7971e,#ffd200)', i: '🔥', t: 'Calories Burned', s: '% of daily TDEE per workout',
      v: Number.isFinite(r.tdee) ? i0(r.tdee) + ' kcal base' : '—',
      d: r.burn ? r.burn.map(b =>
        `<span class="calc-detail-item">${b[0]} <strong>${i0(b[1])} kcal</strong></span>`).join('') : ''
    }),
    r => card({
      g: 'linear-gradient(135deg,#c471f5,#fa71cd)', i: '📚', t: 'BMI Categories', s: 'Reference chart · yours highlighted',
      v: f1(r.bmi), rc: r.bmiColor,
      extra: (() => {
        const cats = [['Underweight', '< 18.5', '#3d82b4', r.bmiCat === 'Underweight'],
        ['Normal', '18.5 – 24.9', '#2ecc71', r.bmiCat === 'Normal'],
        ['Overweight', '25 – 29.9', '#f1c40f', r.bmiCat === 'Overweight'],
        ['Obese', '≥ 30', '#e74c3c', r.bmiCat === 'Obese']];
        return `<div class="bmi-ref">${cats.map(c =>
          `<div class="bmi-row${c[3] ? ' active' : ''}" style="--bc:${c[2]}"><span>${c[0]}</span><span>${c[1]}</span>${c[3] ? '<span class="bmi-you">YOU</span>' : ''}</div>`
        ).join('')}</div>`;
      })(),
      d: Number.isFinite(r.bmi) ? `<span class="calc-detail-item">You are <strong style="color:${r.bmiColor}">${r.bmiCat}</strong></span>` : ''
    })
  ];

  // ---------- tab filters (All / Body / Nutrition / Strength / Health) ----------
  const CAT_MAP = {
    body: [0, 1, 2], nutrition: [3, 4, 5, 6, 7, 8], strength: [9, 10, 11], health: [12, 13, 14]
  };

  function bindTabs(root) {
    root.querySelectorAll('.calc-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.calctab;
        root.querySelectorAll('.calc-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        const allowed = cat === 'all' ? null : new Set(CAT_MAP[cat]);
        root.querySelectorAll('.calc-grid .calc-card').forEach((cardEl, idx) => {
          cardEl.classList.toggle('hidden', allowed ? !allowed.has(idx) : false);
        });
      });
    });
  }

  // ---------- mount helper (used by client tab + admin panel) ----------
  function mountHub(container, scope) {
    const isClient = scope !== 'admin';
    container.innerHTML = `
      <div class="calc-sticky-head">
        <div class="calc-app-title">🧮 Fitness Calculator Hub
          <span class="live-chip"><span class="live-dot"></span> Live Calculations</span>
        </div>
        <div class="calc-hint">${isClient
          ? 'All 15 calculators read your details from <strong>👤 My Profile → 📌 Shared Inputs</strong>. Edit them there and this page updates instantly.'
          : 'Enter the client\'s details <strong>once</strong> — all 15 calculators update instantly. Nothing is sent anywhere until it saves to their cloud profile.'}</div>
      </div>
      ${isClient ? `
      <div class="calc-profile-banner">
        👤 Your <strong>Shared Inputs</strong> now live in <strong>My Profile</strong> — enter them once there and all 15 calculators use them automatically.
        <button type="button" class="calc-goto-profile-btn" id="calcGoProfileBtn${scope === 'admin' ? 'A' : 'C'}">Open My Profile →</button>
      </div>` : `
      <div class="calc-shared-panel">
        <div class="calc-shared-row">
          <div class="calc-shared-label">📌 Shared Inputs — entered once, used by all 15 calculators <span class="calc-profile-note" id="calcProfileNote${scope === 'admin' ? 'A' : 'C'}"></span></div>
          <button type="button" class="calc-reset-btn" onclick="resetFitnessInputs()" title="Restore default values">↺ Reset</button>
        </div>
        <div class="calc-shared-inputs" data-calcscope="admin"></div>
      </div>`}
      <div class="calc-tabs" role="tablist" aria-label="Calculator categories">
        <button class="calc-tab-btn active" data-calctab="all" type="button">🌐 All</button>
        <button class="calc-tab-btn" data-calctab="body" type="button">🧍 Body</button>
        <button class="calc-tab-btn" data-calctab="nutrition" type="button">🥗 Nutrition</button>
        <button class="calc-tab-btn" data-calctab="strength" type="button">💪 Strength</button>
        <button class="calc-tab-btn" data-calctab="health" type="button">❤️ Health</button>
      </div>
      <div class="calc-grid" data-calcscope="${scope}"></div>`;
    bindTabs(container);
    const goBtn = container.querySelector('.calc-goto-profile-btn');
    if (goBtn) goBtn.addEventListener('click', () => {
      const b = document.querySelector('.tab-btn[data-ctab="profile"]');
      if (b) b.click();
      if (typeof window.showToast === 'function') {
        window.showToast('👤 Edit your Shared Inputs in My Profile — the calculators update live.', 'info');
      }
    });
  }

  // ---------- profile form prefill (👤 My Profile merged inline editor) ----------
  // Fills the "📌 Shared Inputs" section of the client's 👤 My Profile form
  // (rendered by js/progress.js → renderClientProfile; the old ✏️ Edit
  // Profile modal with its pc* inputs was merged into that one form).
  // Priority: approved fit_* profile columns → the hub state that is
  // currently loaded for this client → spec defaults.
  const PROFILE_STAT_INPUTS = {
    weight: 'pcx-weight', height: 'pcx-height', age: 'pcx-age', gender: 'pcx-gender',
    activity: 'pcx-activity', goal: 'pcx-goal', waist: 'pcx-waist', neck: 'pcx-neck',
    hip: 'pcx-hip', bench: 'pcx-bench', bodyfat: 'pcx-bodyfat'
  };
  window.prefillProfileCalcStats = function (profileRow, targetIds) {
    const stats = Object.assign({}, DEFAULTS);
    if (scopeId && String(scopeId) === String((APP_STATE.loggedInClient || {}).id)) {
      Object.assign(stats, current);                       // live hub values
    }
    if (profileRow && window.profileHasCalcStats(profileRow)) {
      Object.assign(stats, window.profileCalcStats(profileRow));
    }
    Object.entries(PROFILE_STAT_INPUTS).forEach(([key, fallbackId]) => {
      const id = (targetIds && targetIds[key]) || fallbackId;
      const el = $(id);
      if (!el) return;
      const v = stats[key];
      if (typeof v === 'string') {
        if ([...el.options].some(o => o.value === v)) el.value = v;
      } else {
        el.value = Number.isFinite(v) ? v : '';
      }
    });
  };

  // ---------- 👤 My Profile → 📌 Shared Inputs ----------
  // Typing in the Profile form does NOT autosave anywhere any more: the
  // values reach fitness_inputs / the calculator hub ONLY through the
  // approval flow (client submits → trainer approves → approvals.js calls
  // syncFitnessInputsFromProfile()). The live delegated listener still
  // previews the cards while typing, but nothing is persisted until the
  // client presses "📩 Save to Profile" and the trainer approves.
  window.mountCalcHub = mountHub;

  // ---------- admin client selector (shared inputs sync across both hubs) --
  window.refreshCalcClientSelect = function () {
    const sel = $('adminCalcClientSelect');
    if (!sel || !window.APP_STATE) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— My own demo values (not saved) —</option>' +
      (APP_STATE.clients || []).map(c =>
        `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.login_id || '')})</option>`).join('');
    if (prev && APP_STATE.clients.some(c => String(c.id) === prev)) sel.value = prev;
    else if (!prev && APP_STATE.selectedClientId &&
             APP_STATE.clients.some(c => sameId(c.id, APP_STATE.selectedClientId))) {
      sel.value = String(APP_STATE.selectedClientId);
    }
    loadFitnessInputsFor(sel.value || 'guest');
  };

  function bindAdminSelector() {
    const sel = $('adminCalcClientSelect');
    if (!sel || sel.dataset.bound) return;
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => loadFitnessInputsFor(sel.value || 'guest'));
  }

  // ---------- boot ----------
  function boot() {
    // Client portal tab
    const clientHub = $('ctab-calculators');
    if (clientHub && !clientHub.dataset.mounted) {
      clientHub.dataset.mounted = '1';
      mountHub(clientHub.querySelector('#clientCalcHub'), 'client');
    }
    // Admin workspace tab
    const adminHub = $('adminWorkspaceCalculators');
    if (adminHub && !adminHub.dataset.mounted) {
      adminHub.dataset.mounted = '1';
      mountHub(adminHub.querySelector('#adminCalcHub'), 'admin');
    }
    bindAdminSelector();
    // Real-time updates: one delegated listener covers both hubs' inputs.
    document.removeEventListener('input', onInput);
    document.removeEventListener('change', onInput);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);

    // Initial guest values (kept in sync when no client is selected/logged in).
    renderInputs();
    renderCards();
    try {
      const raw = localStorage.getItem(lsKey('guest'));
      if (raw) { current = Object.assign({}, DEFAULTS, JSON.parse(raw)); renderInputs(); renderCards(); }
    } catch (e) { }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
