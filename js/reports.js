// ============================================================
// js/reports.js — PROFESSIONAL PROGRESS REPORTS (admin + client)
// ------------------------------------------------------------
// • Builds a monthly snapshot per client from approved progress
//   entries.
// • Renders KPI cards, SVG line/bar charts and month-over-month
//   delta tables.
// • Saves every generated report to the `progress_reports` table
//   (localStorage fallback) so history is kept forever and any two
//   saved months can be compared.
// ============================================================
(function () {
  'use strict';

  const LS_KEY = 'pt_progress_reports_v1';

  // ---------- helpers ----------
  function monthKeyOf(dateStr) { return String(dateStr || '').slice(0, 7); } // "YYYY-MM"
  function monthLabel(mk) {
    if (!mk) return '—';
    const [y, m] = mk.split('-').map(Number);
    return `${getMonthName(m - 1)} ${y}`;
  }
  function avg(arr) {
    const v = arr.filter(x => typeof x === 'number' && isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  function fmt(n, dp) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return Number(n).toFixed(dp === undefined ? 1 : dp).replace(/\.0+$/, '');
  }
  function deltaBadge(cur, prev, dp, invertGood) {
    if (cur == null || prev == null) return '<span class="rp-delta flat">new</span>';
    const d = cur - prev;
    if (Math.abs(d) < 0.05) return '<span class="rp-delta flat">±0</span>';
    const good = invertGood ? d < 0 : d > 0;
    // For weight / body fat / waist: down = good (invertGood = true)
    const cls = invertGood === null ? 'flat' : (good ? 'up' : 'down');
    return `<span class="rp-delta ${cls}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d), dp)}</span>`;
  }

  // ---------- build one month's snapshot for a client ----------
  window.buildMonthlySnapshot = function (clientId, mk) {
    const entries = (clientMapGet(APP_STATE.progressEntries, clientId) || [])
      .filter(e => monthKeyOf(e.entry_date) === mk);
    const snap = {
      month: mk,
      sessions: 0,
      workouts_logged: 0,
      weight_kg: avg(entries.map(e => parseFloat(e.weight_kg))),
      body_fat_pct: avg(entries.map(e => parseFloat(e.body_fat_pct))),
      chest_cm: avg(entries.map(e => parseFloat(e.chest_cm))),
      waist_cm: avg(entries.map(e => parseFloat(e.waist_cm))),
      hips_cm: avg(entries.map(e => parseFloat(e.hips_cm))),
      arms_cm: avg(entries.map(e => parseFloat(e.arms_cm))),
      thighs_cm: avg(entries.map(e => parseFloat(e.thighs_cm))),
      entries_count: entries.length
    };
    // Sessions & workout logs for that month
    const [yy, mm] = mk.split('-').map(Number);
    snap.sessions = getSessions(clientId, yy, mm - 1).filter(s => s.checked_at).length;
    Object.keys(APP_STATE.workoutLogsCache).forEach(k => {
      if (k.startsWith(clientId + '-') && k.includes(`-${mk}`)) snap.workouts_logged++;
    });
    return snap;
  };

  // All month keys with data for a client, newest first
  window.getClientReportMonths = function (clientId) {
    const set = new Set();
    (clientMapGet(APP_STATE.progressEntries, clientId) || []).forEach(e => set.add(monthKeyOf(e.entry_date)));
    return [...set].sort().reverse();
  };

  // ---------- SVG chart engine (no dependencies) ----------
  function svgLineChart(seriesList, opts) {
    // seriesList: [{ label, color, points:[{x:monthIdx,y:value}|null] }]
    const W = 560, H = 200, P = { l: 42, r: 12, t: 14, b: 30 };
    const allY = seriesList.flatMap(s => s.points.map(p => p && p.y)).filter(v => v != null && isFinite(v));
    if (allY.length === 0) return '';
    const minY = Math.min(...allY), maxY = Math.max(...allY);
    const pad = (maxY - minY) * 0.15 || 1;
    const lo = minY - pad, hi = maxY + pad;
    const n = Math.max(2, (opts && opts.nLabels) || 2);
    const xAt = i => P.l + (W - P.l - P.r) * (n === 1 ? 0.5 : i / (n - 1));
    const yAt = v => H - P.b - (H - P.t - P.b) * ((v - lo) / (hi - lo || 1));
    let g = `<svg viewBox="0 0 ${W} ${H}" class="rp-chart" role="img" aria-label="${escapeHtml(opts && opts.title || 'Trend chart')}">`;
    // gridlines + y labels
    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * i / 4, y = yAt(v);
      g += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" class="rp-grid"/>`;
      g += `<text x="${P.l - 6}" y="${y + 3}" text-anchor="end" class="rp-axis">${fmt(v, 0)}</text>`;
    }
    // x labels
    (opts.labels || []).forEach((lab, i) => {
      g += `<text x="${xAt(i)}" y="${H - 8}" text-anchor="middle" class="rp-axis">${escapeHtml(lab)}</text>`;
    });
    seriesList.forEach(s => {
      let d = '', started = false;
      s.points.forEach((p, i) => {
        if (!p || p.y == null) { started = false; return; }
        const x = xAt(i), y = yAt(p.y);
        d += started ? ` L${x.toFixed(1)},${y.toFixed(1)}` : ` M${x.toFixed(1)},${y.toFixed(1)}`;
        started = true;
      });
      if (d) g += `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round"/>`;
      s.points.forEach((p, i) => {
        if (!p || p.y == null) return;
        g += `<circle cx="${xAt(i)}" cy="${yAt(p.y)}" r="3.5" fill="${s.color}"><title>${escapeHtml(s.label)}: ${fmt(p.y)}</title></circle>`;
      });
    });
    g += '</svg>';
    return g;
  }

  function svgBarChart(labels, values, color) {
    const W = 560, H = 170, P = { l: 34, r: 10, t: 12, b: 28 };
    const max = Math.max(...values.filter(v => v != null), 1) * 1.15;
    const bw = (W - P.l - P.r) / Math.max(1, values.length);
    let g = `<svg viewBox="0 0 ${W} ${H}" class="rp-chart" role="img" aria-label="Sessions per month">`;
    for (let i = 0; i <= 3; i++) {
      const v = max * i / 3, y = H - P.b - (H - P.t - P.b) * i / 3;
      g += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" class="rp-grid"/>`;
      g += `<text x="${P.l - 5}" y="${y + 3}" text-anchor="end" class="rp-axis">${fmt(v, 0)}</text>`;
    }
    values.forEach((v, i) => {
      if (v == null) return;
      const h = (H - P.t - P.b) * (v / max);
      const x = P.l + i * bw + bw * 0.18, w = bw * 0.64, y = H - P.b - h;
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${color}"><title>${escapeHtml(labels[i])}: ${v}</title></rect>`;
      g += `<text x="${x + w / 2}" y="${y - 4}" text-anchor="middle" class="rp-axis">${v}</text>`;
      g += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" class="rp-axis">${escapeHtml(labels[i])}</text>`;
    });
    g += '</svg>';
    return g;
  }

  // ---------- persistence ----------
  function lsReports() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } }
  function lsSave(r) { localStorage.setItem(LS_KEY, JSON.stringify(r)); }

  window.loadSavedReports = async function () {
    const sb = APP_STATE.supabaseClient;
    if (!sb) { APP_STATE.savedReports = lsReports(); return; }
    try {
      const { data, error } = await sb.from('progress_reports').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      APP_STATE.savedReports = data || [];
    } catch (e) {
      // Table not created yet → fall back to local storage so nothing breaks.
      APP_STATE.savedReports = lsReports();
    }
  };

  // One-time migration: reports generated while the cloud table was missing
  // live in localStorage — push them up and clear the local copy afterwards.
  async function migrateLocalReports() {
    const sb = APP_STATE.supabaseClient;
    if (!sb) return;
    const local = lsReports();
    if (local.length === 0) return;
    try {
      const rows = local.map(r => ({
        client_id: r.client_id, month_key: r.month_key,
        period_from: r.period_from, period_to: r.period_to,
        snapshot: r.snapshot, comparison: r.comparison,
        generated_by: r.generated_by || 'admin'
      }));
      const { error } = await sb.from('progress_reports').insert(rows);
      if (error) return; // still missing/blocked — keep local copy for next time
      localStorage.removeItem(LS_KEY);
    } catch (e) { /* keep local copy */ }
  }

  // Reports are UNIQUE per (client_id, month_key): re-generating a month's
  // report must UPDATE the existing row — never insert another one. Without
  // this, every 👁 View click (which auto-saves a snapshot) piled up a new
  // duplicate line in the Saved reports history.
  window.saveProgressReport = async function (report) {
    const sb = APP_STATE.supabaseClient;
    if (!sb) { pushLocal(report); return { local: true }; }
    try {
      const existing = (APP_STATE.savedReports || [])
        .find(r => r.client_id === report.client_id && r.month_key === report.month_key);
      const payload = {
        client_id: report.client_id,
        month_key: report.month_key,
        period_from: report.period_from,
        period_to: report.period_to,
        snapshot: report.snapshot,
        comparison: report.comparison,
        generated_by: 'admin'
      };
      let error;
      if (existing && existing.id) {
        const res = await sb.from('progress_reports')
          .update(payload).eq('id', existing.id);
        error = res.error;
      } else {
        const res = await sb.from('progress_reports').insert(payload);
        error = res.error;
      }
      if (error) throw error;
      const stored = Object.assign({}, report, existing ? { id: existing.id } : {});
      APP_STATE.savedReports = [stored,
        ...(APP_STATE.savedReports || []).filter(r =>
          !(r.client_id === report.client_id && r.month_key === report.month_key))];
      return { ok: true };
    } catch (e) {
      if (window.isMissingTableError(e)) {
        const fixed = await window.ensureTableExists('progress_reports');
        if (fixed) { await migrateLocalReports(); return window.saveProgressReport(report); }
      }
      pushLocal(report); // never lose the record
      return { local: true, error: e };
    }
  };
  function pushLocal(r) {
    const all = lsReports().filter(x => !(x.client_id === r.client_id && x.month_key === r.month_key));
    all.unshift(r); lsSave(all.slice(0, 200));
    APP_STATE.savedReports = all;
  }

  // ---------- admin report panel ----------
  window.openReportsPanel = function () {
    if (typeof window.showAdminPanel === 'function') {
      showAdminPanel('reportsPanel', 'initReportsPanel');
      return;
    }
    if (typeof showAdminWorkspaceTab === 'function') showAdminWorkspaceTab('clients');
    ['libraryPanel', 'settingsPanel', 'approvalsPanel', 'classTimesPanel', 'requestsPanel'].forEach(id => {
      const el = $(id); if (el) el.classList.add('hidden');
    });
    const panel = $('reportsPanel'); if (!panel) return;
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) initReportsPanel();
  };

  window.initReportsPanel = async function () {
    // Bind the panel's own controls first (idempotent), then populate.
    try { if (typeof window.bindReportEvents === 'function') bindReportEvents(); } catch (e) {}
    // Make sure saved-report history is loaded (loadAllData may not have run
    // it yet, e.g. right after login or when the table was missing).
    if (!APP_STATE.savedReports || APP_STATE.savedReports.length === 0) {
      try { await loadSavedReports(); } catch (e) {}
    }
    initReportsPanelFill();
  };

  function initReportsPanelFill() {
    const sel = $('rpClientSelect');
    if (!sel) return;
    const current = sel.value || APP_STATE.selectedClientId || '';
    sel.innerHTML = '<option value="">— Select client —</option>' +
      APP_STATE.clients.slice().sort((a, b) => a.name.localeCompare(b.name)).map(c =>
        `<option value="${c.id}">${escapeHtml(c.name)}${c.gym_name ? ' · ' + escapeHtml(c.gym_name) : ''}</option>`).join('');
    sel.value = current;
    const months = sel.value ? getClientReportMonths(sel.value) : [];
    const to = $('rpMonthTo'), from = $('rpMonthFrom');
    if (months.length) {
      to.value = months[0];
      from.value = months[Math.min(1, months.length - 1)];
    } else {
      const now = new Date();
      to.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      from.value = `${now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()}-${String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, '0')}`;
    }
    renderReportForClient(sel.value, from.value, to.value, false);
    renderSavedReportHistory();
  }

  function renderReportForClient(clientId, mkFrom, mkTo, saving) {
    const area = $('rpReportArea');
    if (!area) return;
    const c = getClient(clientId);
    if (!c) { area.innerHTML = '<div class="empty-message">Select a client to generate their report.</div>'; return; }
    const monthsAll = getClientReportMonths(clientId);
    if (monthsAll.length === 0) {
      area.innerHTML = '<div class="empty-message">📈 No progress data yet for this client. Ask them to add their monthly progress entry (mandatory every month).</div>';
      return;
    }
    // If the requested month has no data (e.g. after switching clients),
    // snap the pickers to the newest months that actually have entries —
    // otherwise the report renders an empty table and looks "broken".
    // NOTE: `return` is mandatory here — without it the original render kept
    // running afterwards, double-rendering the report AND double-auto-saving
    // a snapshot on every click (duplicate history rows).
    if (!monthsAll.includes(mkTo) || !monthsAll.includes(mkFrom)) {
      const fixedTo = monthsAll.includes(mkTo) ? mkTo : monthsAll[0];
      const fixedFrom = monthsAll.includes(mkFrom) ? mkFrom
        : (monthsAll[Math.min(1, monthsAll.length - 1)] || fixedTo);
      const tEl = $('rpMonthTo'), fEl = $('rpMonthFrom');
      if (tEl) tEl.value = fixedTo;
      if (fEl) fEl.value = fixedFrom;
      return renderReportForClient(clientId, fixedFrom, fixedTo, saving);
    }
    // Re-entrancy guard: if we are already rendering this exact report,
    // bail out instead of kicking off another render + auto-save cycle.
    const renderKey = `${clientId}|${mkFrom}|${mkTo}`;
    if (area.dataset.rendering === renderKey) return;
    area.dataset.rendering = renderKey;
    try {
    const fromSnap = buildMonthlySnapshot(clientId, mkFrom);
    const toSnap = buildMonthlySnapshot(clientId, mkTo);
    // Trend across last up-to-6 months (chronological)
    const trend = monthsAll.slice(0, 6).reverse();
    const labels = trend.map(mk => mk.slice(5) + '/' + mk.slice(2, 4));
    const snaps = trend.map(mk => buildMonthlySnapshot(clientId, mk));
    const wSeries = snaps.map(s => ({ x: 0, y: s.weight_kg }));
    const bSeries = snaps.map(s => ({ x: 0, y: s.body_fat_pct }));
    const sessBars = snaps.map(s => s.sessions);

    const rows = [
      ['Weight (kg)', 'weight_kg', 1, true],
      ['Body fat (%)', 'body_fat_pct', 1, true],
      ['BMI', 'bmi', 1, true],
      ['Lean mass (kg)', 'lean_mass_kg', 1, null],
      ['Chest (cm)', 'chest_cm', 1, null],
      ['Waist (cm)', 'waist_cm', 1, true],
      ['Hips (cm)', 'hips_cm', 1, null],
      ['Arms (cm)', 'arms_cm', 1, null],
      ['Thighs (cm)', 'thighs_cm', 1, null],
      ['Sessions done', 'sessions', 0, null],
      ['Workouts logged', 'workouts_logged', 0, null]
    ];
    let table = `<table class="rp-table"><thead><tr><th>Metric</th><th>${escapeHtml(monthLabel(mkFrom))}</th><th>${escapeHtml(monthLabel(mkTo))}</th><th>Change</th></tr></thead><tbody>`;
    rows.forEach(([label, key, dp, invertGood]) => {
      const a = fromSnap[key], b = toSnap[key];
      if (a == null && b == null) return;
      table += `<tr><td>${label}</td><td>${fmt(a, dp)}</td><td>${fmt(b, dp)}</td><td>${deltaBadge(b, a, dp, invertGood)}</td></tr>`;
    });
    table += '</tbody></table>';

    const legend = `<div class="rp-legend"><span><i style="background:#1976d2"></i>Weight (kg)</span><span><i style="background:#e65100"></i>Body fat (%)</span></div>`;
    area.innerHTML = `
      <div class="rp-report">
        <div class="rp-head">
          <div>
            <div class="rp-title">📊 ${escapeHtml(c.name)}</div>
            <div class="rp-sub">${c.gym_name ? '🏢 ' + escapeHtml(c.gym_name) + ' · ' : ''}${escapeHtml(monthLabel(mkFrom))} → ${escapeHtml(monthLabel(mkTo))} · generated ${new Date().toLocaleDateString()}</div>
          </div>
          <div class="rp-kpis">
            <div class="rp-kpi"><span>${fmt(toSnap.weight_kg)}</span><small>kg</small></div>
            <div class="rp-kpi"><span>${fmt(toSnap.body_fat_pct)}</span><small>% fat</small></div>
            <div class="rp-kpi"><span>${fmt(toSnap.bmi)}</span><small>BMI</small></div>
            <div class="rp-kpi"><span>${toSnap.sessions}</span><small>sessions</small></div>
          </div>
        </div>
        <div class="rp-charts">
          <div class="rp-chart-card">${legend}${svgLineChart(
            [{ label: 'Weight', color: '#1976d2', points: wSeries }, { label: 'Body fat', color: '#e65100', points: bSeries }],
            { labels, nLabels: labels.length, title: 'Weight & body fat trend' }) || '<div class="empty-message">Not enough data for a trend chart.</div>'}</div>
          <div class="rp-chart-card"><div class="rp-legend"><span><i style="background:#2e7d32"></i>Sessions completed</span></div>${svgBarChart(labels, sessBars, '#2e7d32')}</div>
        </div>
        ${table}
      </div>`;

    if (!saving) {
      // Auto-save the snapshot for the "to" month so history accumulates.
      const report = {
        id: `local-${Date.now()}`,
        client_id: clientId,
        month_key: mkTo,
        period_from: mkFrom,
        period_to: mkTo,
        snapshot: toSnap,
        comparison: { from: fromSnap, to: toSnap },
        created_at: new Date().toISOString()
      };
      window.saveProgressReport(report).then(res => {
        if (res.ok) renderSavedReportHistory();
      });
    }
    } finally {
      delete area.dataset.rendering;
    }
  }

  function renderSavedReportHistory() {
    const box = $('rpHistoryList');
    if (!box) return;
    const reports = APP_STATE.savedReports || [];
    if (reports.length === 0) { box.innerHTML = '<div class="empty-message">No saved reports yet — generate one above.</div>'; return; }
    // Defensive de-dupe: show at most ONE row per (client, month) even if the
    // table still contains legacy duplicates from before the upsert fix.
    const seenKeys = new Set();
    const uniqueReports = reports.filter(r => {
      const k = `${r.client_id}|${r.month_key}`;
      if (seenKeys.has(k)) return false;
      seenKeys.add(k);
      return true;
    });
    box.innerHTML = uniqueReports.slice(0, 30).map(r => {
      const c = getClient(r.client_id);
      const s = r.snapshot || {};
      return `<div class="rp-history-item">
        <span class="rp-h-date">🗓 ${escapeHtml(monthLabel(r.month_key))}</span>
        <strong>${escapeHtml(c ? c.name : 'Unknown client')}</strong>
        <span class="rp-h-metrics">${fmt(s.weight_kg)} kg · ${fmt(s.body_fat_pct)}% · BMI ${fmt(s.bmi)} · ${s.sessions || 0} sessions</span>
        <button class="btn-secondary btn-small rp-h-view" data-cid="${r.client_id}" data-from="${escapeHtml(r.period_from || r.month_key)}" data-to="${escapeHtml(r.month_key)}">👁 View</button>
      </div>`;
    }).join('');
    box.querySelectorAll('.rp-h-view').forEach(b => b.addEventListener('click', () => {
      $('rpClientSelect').value = b.dataset.cid;
      $('rpMonthFrom').value = b.dataset.from;
      $('rpMonthTo').value = b.dataset.to;
      // Pure READ action: render the saved report WITHOUT auto-saving a new
      // snapshot — that used to insert a duplicate history row on every click.
      renderReportForClient(b.dataset.cid, b.dataset.from, b.dataset.to, true);
      $('rpReportArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  window.bindReportEvents = function () {
    const sel = $('rpClientSelect'); if (!sel || sel.dataset.bound === '1') return;
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => renderReportForClient(sel.value, $('rpMonthFrom').value, $('rpMonthTo').value, false));
    ['rpMonthFrom', 'rpMonthTo'].forEach(id => $(id).addEventListener('change', () => {
      if (sel.value) renderReportForClient(sel.value, $('rpMonthFrom').value, $('rpMonthTo').value, false);
    }));
    const gen = $('rpGenerateBtn');
    if (gen) gen.addEventListener('click', () => {
      if (!sel.value) { showStatus($('rpStatus'), '⚠️ Pick a client first.', 'error'); return; }
      renderReportForClient(sel.value, $('rpMonthFrom').value, $('rpMonthTo').value, false);
      showStatus($('rpStatus'), '✅ Report generated & saved to history.', 'success');
    });
    const print = $('rpPrintBtn');
    if (print) print.addEventListener('click', () => {
      const content = $('rpReportArea').innerHTML;
      if (!content.trim()) { showStatus($('rpStatus'), '⚠️ Nothing to print yet.', 'error'); return; }
      const w = window.open('', '_blank', 'width=840,height=900');
      w.document.write(`<!DOCTYPE html><html><head><title>Progress Report</title><style>
        body{font-family:Segoe UI,Arial,sans-serif;color:#1d2b36;padding:24px;}
        svg{max-width:100%;height:auto}.rp-grid{stroke:#dde7ef;stroke-width:1}.rp-axis{font-size:10px;fill:#5b7386}
        table{border-collapse:collapse;width:100%;margin-top:14px}td,th{border:1px solid #dbe6ee;padding:6px 10px;font-size:13px;text-align:left}
        th{background:#f2f7fb}.rp-kpis{display:flex;gap:10px}.rp-kpi{border:1px solid #dbe6ee;border-radius:10px;padding:8px 14px;text-align:center}
        .rp-delta.up{color:#2e7d32}.rp-delta.down{color:#c62828}.rp-delta.flat{color:#607d8b}
        .rp-charts{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
        .rp-chart-card{border:1px solid #e3ecf3;border-radius:12px;padding:10px}
        <\/style></head><body>${content}<script>window.onload=function(){window.print();}<\/script></body></html>`);
      w.document.close();
    });
    const share = $('rpShareBtn');
    if (share) share.addEventListener('click', () => {
      const cid = sel.value; const c = getClient(cid);
      if (!c) { showStatus($('rpStatus'), '⚠️ Pick a client first.', 'error'); return; }
      const msg = `📊 *Progress Report — ${c.name}*\nYour trainer has published your latest monthly progress report.\nOpen the portal → 📈 Progress tab to see your charts and month-over-month comparison. 💪`;
      notifyClientWhatsApp(c, msg);
      showStatus($('rpStatus'), '📩 WhatsApp opened with the report message.', 'success');
    });
  };

  // ---------- client-side report view ----------
  window.renderClientReport = function (c) {
    const body = $('clientReportBody');
    if (!body || !c) return;
    const monthsAll = getClientReportMonths(c.id);
    const from = $('crMonthFrom'), to = $('crMonthTo');
    if (from && to) {
      const opts = monthsAll.map(mk => `<option value="${mk}">${escapeHtml(monthLabel(mk))}</option>`).join('');
      if (opts) {
        from.innerHTML = to.innerHTML = opts;
        if (!from.value) from.value = monthsAll[Math.min(1, monthsAll.length - 1)];
        if (!to.value) to.value = monthsAll[0];
      }
    }
    if (monthsAll.length === 0) {
      body.innerHTML = '<div class="empty-message">Add your first progress entry to unlock your monthly report. 📈 It\'s mandatory once a month!</div>';
      return;
    }
    const mkFrom = from && from.value ? from.value : monthsAll[monthsAll.length - 1];
    const mkTo = to && to.value ? to.value : monthsAll[0];
    const trend = monthsAll.slice(0, 6).reverse();
    const labels = trend.map(mk => mk.slice(5) + '/' + mk.slice(2, 4));
    const snaps = trend.map(mk => buildMonthlySnapshot(c.id, mk));
    const f = buildMonthlySnapshot(c.id, mkFrom), t = buildMonthlySnapshot(c.id, mkTo);
    const rows = [
      ['Weight (kg)', 'weight_kg', 1, true], ['Body fat (%)', 'body_fat_pct', 1, true],
      ['BMI', 'bmi', 1, true], ['Waist (cm)', 'waist_cm', 1, true], ['Arms (cm)', 'arms_cm', 1, null],
      ['Sessions done', 'sessions', 0, null]
    ];
    let table = `<table class="rp-table"><thead><tr><th>Metric</th><th>${escapeHtml(monthLabel(mkFrom))}</th><th>${escapeHtml(monthLabel(mkTo))}</th><th>Change</th></tr></thead><tbody>`;
    rows.forEach(([label, key, dp, inv]) => {
      if (f[key] == null && t[key] == null) return;
      table += `<tr><td>${label}</td><td>${fmt(f[key], dp)}</td><td>${fmt(t[key], dp)}</td><td>${deltaBadge(t[key], f[key], dp, inv)}</td></tr>`;
    });
    table += '</tbody></table>';
    body.innerHTML = `
      <div class="rp-report">
        <div class="rp-charts">
          <div class="rp-chart-card"><div class="rp-legend"><span><i style="background:#1976d2"></i>Weight (kg)</span><span><i style="background:#e65100"></i>Body fat (%)</span></div>${svgLineChart(
            [{ label: 'Weight', color: '#1976d2', points: snaps.map(s => ({ y: s.weight_kg })) },
             { label: 'Body fat', color: '#e65100', points: snaps.map(s => ({ y: s.body_fat_pct })) }],
            { labels, nLabels: labels.length, title: 'Your trend' }) || '<div class="empty-message">Keep adding monthly entries to see your trend curve.</div>'}</div>
          <div class="rp-chart-card"><div class="rp-legend"><span><i style="background:#2e7d32"></i>Sessions completed</span></div>${svgBarChart(labels, snaps.map(s => s.sessions), '#2e7d32')}</div>
        </div>
        ${table}
      </div>`;
  };

  window.bindClientReportEvents = function () {
    ['crMonthFrom', 'crMonthTo'].forEach(id => {
      const el = $(id);
      if (el && el.dataset.bound !== '1') {
        el.dataset.bound = '1';
        el.addEventListener('change', () => { if (APP_STATE.loggedInClient) renderClientReport(APP_STATE.loggedInClient); });
      }
    });
  };
})();
