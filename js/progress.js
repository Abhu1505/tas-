window.renderProgressEntries = function (containerId, clientId, adminMode) {
  const entries = clientMapGet(APP_STATE.progressEntries, clientId) || [];
  // Only GENUINE pending 'add' proposals show the ⏳ card — legacy rows that
  // were already decided (or whose entry now exists officially) are filtered
  // out by the shared true-pending function, killing false "Pending approval".
  const pending = window.getClientPendingRows
    ? window.getClientPendingRows(clientId).progressRows.filter(a => a.action === 'add')
    : APP_STATE.progressApprovals
      .filter(a => sameId(a.client_id, clientId) && a.status === 'pending' && a.action === 'add');
  const container = $(containerId);
  if (!container) return;
  if (entries.length === 0 && pending.length === 0) {
    container.innerHTML = `<div class="empty-message">No progress entries yet.</div>`;
    return;
  }
  let html = '';
  if (!adminMode) {
    pending.forEach(a => {
      const d = a.proposed_data || {};
      const parts = [];
      if (d.weight_kg) parts.push(`<div class="item"><div class="label">Weight</div><div class="value">${d.weight_kg} kg</div></div>`);
      if (d.body_fat_pct) parts.push(`<div class="item"><div class="label">Body Fat</div><div class="value">${d.body_fat_pct}%</div></div>`);
      if (d.chest_cm) parts.push(`<div class="item"><div class="label">Chest</div><div class="value">${d.chest_cm} cm</div></div>`);
      if (d.waist_cm) parts.push(`<div class="item"><div class="label">Waist</div><div class="value">${d.waist_cm} cm</div></div>`);
      if (d.hips_cm) parts.push(`<div class="item"><div class="label">Hips</div><div class="value">${d.hips_cm} cm</div></div>`);
      if (d.arms_cm) parts.push(`<div class="item"><div class="label">Arms</div><div class="value">${d.arms_cm} cm</div></div>`);
      if (d.thighs_cm) parts.push(`<div class="item"><div class="label">Thighs</div><div class="value">${d.thighs_cm} cm</div></div>`);
      html += `<div class="progress-entry pending"><div class="progress-entry-header"><span class="progress-entry-date">📅 ${d.entry_date || '—'}</span><span class="progress-entry-pending-badge">⏳ Pending approval</span></div><div class="progress-entry-grid">${parts.join('')}</div>${d.notes ? `<div class="progress-entry-note">📝 ${escapeHtml(d.notes)}</div>` : ''}</div>`;
    });
  }
  entries.forEach(e => {
    const byLabel = e.added_by === 'admin' ? '👨‍🏫 Admin' : '🙋 Client';
    const parts = [];
    if (e.weight_kg) parts.push(`<div class="item"><div class="label">Weight</div><div class="value">${e.weight_kg} kg</div></div>`);
    if (e.body_fat_pct) parts.push(`<div class="item"><div class="label">Body Fat</div><div class="value">${e.body_fat_pct}%</div></div>`);
    if (e.chest_cm) parts.push(`<div class="item"><div class="label">Chest</div><div class="value">${e.chest_cm} cm</div></div>`);
    if (e.waist_cm) parts.push(`<div class="item"><div class="label">Waist</div><div class="value">${e.waist_cm} cm</div></div>`);
    if (e.hips_cm) parts.push(`<div class="item"><div class="label">Hips</div><div class="value">${e.hips_cm} cm</div></div>`);
    if (e.arms_cm) parts.push(`<div class="item"><div class="label">Arms</div><div class="value">${e.arms_cm} cm</div></div>`);
    if (e.thighs_cm) parts.push(`<div class="item"><div class="label">Thighs</div><div class="value">${e.thighs_cm} cm</div></div>`);
    let photoHtml = '';
    if (e.photo_url) {
      if (/^https?:\/\//.test(e.photo_url))
        photoHtml = `<div style="margin-top:0.4rem;font-size:0.75rem;"><a href="${escapeHtml(e.photo_url)}" target="_blank" style="color:#1976d2;">📷 View photo</a></div>`;
      else
        photoHtml = `<div class="progress-photo-wrap"><img data-gdrive-id="${escapeHtml(e.photo_url)}" alt="Progress photo"></div>`;
    }
    html += `<div class="progress-entry"><div class="progress-entry-header"><span class="progress-entry-date">📅 ${e.entry_date}</span><span class="progress-entry-by">${byLabel}</span></div><div class="progress-entry-grid">${parts.join('')}</div>${e.notes ? `<div class="progress-entry-note">📝 ${escapeHtml(e.notes)}</div>` : ''}${photoHtml}${adminMode ? `<div style="margin-top:0.5rem;text-align:right;"><button class="btn-danger-small btn-small delete-progress-btn" data-id="${e.id}" data-client="${clientId}">🗑️</button></div>` : ''}</div>`;
  });
  container.innerHTML = html;
  if (window.DriveImages) window.DriveImages.init(container);
  if (adminMode) {
    container.querySelectorAll('.delete-progress-btn').forEach(b => {
      b.addEventListener('click', async () => {
        if (!await uiConfirm({ title: 'Delete Progress Entry', message: 'Delete this progress entry permanently?', confirmText: '🗑️ Delete', danger: true })) return;
        await APP_STATE.supabaseClient.from('progress_entries').delete().eq('id', b.dataset.id);
        clientMapSet(APP_STATE.progressEntries, b.dataset.client, (clientMapGet(APP_STATE.progressEntries, b.dataset.client) || [])
          .filter(x => String(x.id) !== String(b.dataset.id)));
        renderProgressEntries(containerId, b.dataset.client, true);
      });
    });
  }
};

window.renderAdminProgress = function () {
  if (APP_STATE.selectedClientId) renderProgressEntries('adminProgressList', APP_STATE.selectedClientId, true);
  if (typeof window.renderProgressDashboard === 'function') window.renderProgressDashboard();
};

// ============================================================
// MONTHLY PROGRESS DASHBOARD — every client must add at least one
// progress entry per calendar month. Green tick = submitted,
// red cross = missing. Rendered in the admin "Progress" tab.
// ============================================================
window.renderProgressDashboard = function () {
  const box = $('progressDashboardContainer');
  if (!box) return;
  const clients = APP_STATE.clients.filter(c => c.active);
  if (clients.length === 0) { box.innerHTML = '<div class="empty-message">No active clients yet.</div>'; return; }
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  let compliantCount = 0;
  let html = `<table class="compliance-table"><thead><tr><th>Client</th>${
    months.map(mk => `<th>${getMonthName(parseInt(mk.slice(5, 7), 10) - 1).slice(0, 3)} ${mk.slice(2, 4)}</th>`).join('')
  }</tr></thead><tbody>`;
  clients.forEach(c => {
    const comp = getProgressCompliance(c, months[months.length - 1]);
    // A month counts as required only from the month the client joined.
    const joinKey = getClientMonthsSinceJoin(c, months[months.length - 1])[0] || '9999-99';
    const cells = months.map(mk => {
      if (mk < joinKey) return '<td class="comp-na">·</td>';
      return comp.covered.has(mk)
        ? '<td class="comp-ok" title="Progress submitted">✔</td>'
        : '<td class="comp-missing" title="Missing this month">✘</td>';
    }).join('');
    const missingRecent = months.filter(mk => mk >= joinKey && !comp.covered.has(mk));
    if (missingRecent.length === 0) compliantCount++;
    html += `<tr><td class="comp-name">${escapeHtml(c.name)}</td>${cells}</tr>`;
  });
  html += '</tbody></table>';
  const summary = `${compliantCount}/${clients.length} clients fully up to date`
    + (clients.length - compliantCount > 0 ? ' — send them a reminder 📩' : ' 🎉');
  box.innerHTML = `<div class="compliance-summary ${compliantCount === clients.length ? 'ok' : 'warn'}">${summary}</div>` + html;
};

window.renderClientProgress = function (c) {
  renderProgressEntries('clientProgressList', c.id, false);
  // 📈 Keep the charts/KPI insights panel in sync with the entry list.
  try { if (typeof window.renderClientInsights === 'function') window.renderClientInsights(c.id); } catch (e) { }
};

window.renderClientHistory = function (c) {
  const container = $('clientHistoryList');
  if (!container) return;
  // 🔒 Client's own history merges their pending edit proposals (draft view);
  // the admin/trainer views keep showing only approved values.
  const merge = !!APP_STATE.loggedInClient && typeof getPendingLogEditsFor === 'function';
  // Includes BOTH days with logged exercises AND finished sessions (even if
  // no exercises were logged), so completed classes are never hidden.
  const dates = getAllWorkoutDates(c.id);
  if (dates.length === 0) {
    container.innerHTML = `<div class="empty-message">No workouts logged yet.<br>Your finished sessions will appear here automatically.</div>`;
    return;
  }
  let html = '';
  dates.forEach(dateStr => {
    let logs = getWorkoutLogs(c.id, dateStr);
    let pendCount = 0;
    if (merge) {
      const pend = getPendingLogEditsFor(c.id, dateStr);
      const map = {};
      pend.forEach(r => { if (r.proposed_data && r.entry_log_id != null) map[String(r.entry_log_id)] = r; });
      pendCount = pend.length;
      logs = logs
        .filter(log => (map[String(log.id)] || {}).proposed_action !== 'delete')
        .map(log => {
          const pr = map[String(log.id)];
          return (pr && pr.proposed_action === 'edit') ? { ...log, ...pr.proposed_data } : log;
        })
        .concat(pend.filter(r => r.proposed_action === 'add' && r.proposed_data)
          .map(r => ({ id: 'proposed-' + r.id, exercise_name: (r.proposed_data || {}).exercise_name || 'New exercise', _proposed: true })));
    }
    const finished = isSessionCheckedForDate(c.id, dateStr);
    const dParts = dateStr.split('-');
    const dateLabel = formatDateReadable(parseInt(dParts[0]), parseInt(dParts[1]) - 1, parseInt(dParts[2]));
    let exercisesHtml = '';
    logs.forEach(log => {
      const name = getWorkoutDisplayName(log);
      const details = [];
      if (log.sets_done) details.push(`${log.sets_done}×`);
      if (log.reps_done) details.push(log.reps_done);
      if (log.weight_done) details.push(`@ ${log.weight_done}`);
      exercisesHtml += `<div class="history-exercise"><span class="history-exercise-name">${escapeHtml(name)}${log._proposed ? ' <span class="lock-status-chip" style="font-size:0.6rem;">🕓 pending approval</span>' : ''}</span><span class="history-exercise-details">${escapeHtml(details.join(' ') || '—')}</span></div>`;
    });
    if (logs.length === 0 && finished) {
      exercisesHtml = `<div class="history-exercise"><span class="history-exercise-name" style="font-style:italic;color:var(--muted);">Session finished — no exercises were logged for this day.</span></div>`;
    }
    const countLabel = logs.length > 0
      ? `${logs.length} exercise${logs.length > 1 ? 's' : ''}`
      : 'no log';
    // Clients edit via ✏️ (staged proposals, applied on trainer approval);
    // class cancellations are 🚫 staged requests, applied on approval.
    const chips = [];
    if (pendCount > 0) chips.push(`<span class="lock-status-chip" title="Waiting for trainer approval">🕓 ${pendCount} change${pendCount > 1 ? 's' : ''} pending</span>`);
    // No 📨 Request button any more — schedule changes go through ✏️ Edit
    // (exercise proposals) or the per-day controls in the upcoming card.
    const extraHtml = chips.length ? `<span class="lock-status-chip-wrap">${chips.join(' ')}</span>` : '';
    html += `<div class="history-item ${finished ? 'finished' : 'open'}" data-date="${dateStr}">
      <div class="history-item-header">
        <span class="history-item-date">📅 ${dateLabel}</span>
        <span class="history-item-meta">
          ${extraHtml}
          <span class="history-item-count">${countLabel}</span>
        </span>
      </div>
      <div class="history-item-exercises hidden">${exercisesHtml}</div>
    </div>`;
  });
  container.innerHTML = html;
  container.querySelectorAll('.history-item').forEach(item =>
    item.addEventListener('click', () => {
      const expanded = item.classList.toggle('expanded');
      item.querySelector('.history-item-exercises').classList.toggle('hidden', !expanded);
    }));
};

window.initClientLogViewer = function () {
  const list = $('clientHistoryList');
  if (!list || list.dataset.viewerBound === '1') return;
  list.dataset.viewerBound = '1';
  list.addEventListener('dblclick', (e) => {
    const c = APP_STATE.loggedInClient;
    if (!c) return;
    const item = e.target.closest('.history-item');
    if (!item) return;
    openClientDayLog(item.dataset.date);
  });
};

// Open the day-log modal for a specific ISO date from the client portal.
// Works across month boundaries (the admin grid is single-month, so we set
// selectedMonth/selectedDay accordingly before reusing the same modal).
// Clients get a READ-ONLY view of their approved log — the trainer maintains it.
window.openClientDayLog = function (dateStr) {
  const c = APP_STATE.loggedInClient;
  if (!c || !dateStr) return;
  const parts = dateStr.split('-').map(Number);
  APP_STATE.selectedClientId = c.id;
  APP_STATE.selectedYear = parts[0];
  APP_STATE.selectedMonth = parts[1] - 1;
  APP_STATE.selectedDay = parts[2];
  openDayLogModal(parts[2]);
  if (!APP_STATE.loggedInClient) return;

  const body = $('addExerciseBody');
  if (body) body.classList.add('hidden');
  const toggle = $('addExerciseToggleBtn');
  if (toggle) toggle.style.display = 'none';

  document.querySelectorAll('#dayLogModal input, #dayLogModal select, #dayLogModal textarea')
    .forEach(el => { el.disabled = true; });
  document.querySelectorAll('#dayLogModal .remove-log-btn, #dayLogModal .library-chip')
    .forEach(el => el.remove());

  const freeRow = $('freeExName') ? $('freeExName').closest('.free-add-row') : null;
  if (freeRow) freeRow.style.display = 'none';

  const banner = $('dayLogLockBanner');
  if (banner) {
    const d = document.createElement('div');
    d.className = 'day-open-banner';
    d.style.cssText = 'display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;margin-top:0.4rem;';
    d.innerHTML = `👁 Read-only view of your approved log. Need a change? Ask your trainer.`;
    banner.appendChild(d);
  }
};

window.renderClientPlan = function (c, assignedOverride) {
  const container = $('clientPlanList');
  if (!container) return;

  // First paint while data is still loading: show a skeleton, not the empty
  // state — otherwise clients briefly see "No template exercises assigned".
  if (assignedOverride === undefined && APP_STATE.clientExercisesCache === null) {
    container.innerHTML = `<div class="plan-empty"><div class="plan-empty-icon">⏳</div><div>Loading your plan…</div></div>`;
    return;
  }

  const assigned = (assignedOverride !== undefined ? assignedOverride
    : (clientMapGet(APP_STATE.clientExercisesCache, c.id) || []))
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  // Which exercises were already performed in at least one finished session?
  const doneNames = new Set();
  getAllWorkoutDates(c.id).forEach(dateStr => {
    if (!isSessionCheckedForDate(c.id, dateStr)) return;
    getWorkoutLogs(c.id, dateStr).forEach(log => {
      const n = (getWorkoutDisplayName(log) || '').trim().toLowerCase();
      if (n) doneNames.add(n);
      if (log.exercise_id) {
        const ex = getExercise(log.exercise_id);
        if (ex) doneNames.add((ex.name || '').trim().toLowerCase());
      }
    });
  });

  if (assigned.length === 0) {
    // No template assigned yet — but if the client/trainer has been logging
    // exercises directly on days, show those as the working plan so the tab
    // is never misleadingly empty.
    const loggedNames = [];
    const seen = new Set();
    getAllWorkoutDates(c.id).forEach(dateStr => {
      getWorkoutLogs(c.id, dateStr).forEach(log => {
        const n = (getWorkoutDisplayName(log) || '').trim();
        if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); loggedNames.push(n); }
      });
    });
    if (loggedNames.length > 0) {
      let lhtml = '';
      loggedNames.forEach(n => {
        const done = doneNames.has(n.toLowerCase());
        lhtml += `<div class="plan-card ${done ? 'done' : ''}">
          <div class="plan-card-main"><div class="plan-card-name">${escapeHtml(n)}</div>
          <div class="plan-card-meta"><span class="plan-chip subtle">Logged in sessions</span></div></div>
          <div class="plan-card-status">${done ? '<span class="history-pill done">✅ Done in a finished session</span>' : '<span class="history-pill open">⏳ Not completed yet</span>'}</div>
        </div>`;
      });
      container.innerHTML = `<div class="plan-progress-head"><span><strong>${loggedNames.length}</strong> exercises logged so far (no trainer template assigned yet)</span></div>${lhtml}`;
    } else {
      container.innerHTML = `<div class="plan-empty">
        <div class="plan-empty-icon">🏋️</div>
        <div><strong>No template exercises assigned yet.</strong><br>
        Your trainer sets your plan here — meanwhile you can still log any exercise
        on an open (not finished) session day from the History tab.</div></div>`;
    }
    // Still try to refresh from the server in case the bulk cache missed rows.
    if (typeof window.fetchClientPlan === 'function' && APP_STATE.supabaseClient) {
      window.fetchClientPlan(c.id).then(list => {
        if (list && list.length) renderClientPlan(c, list);
      }).catch(() => {});
    }
    return;
  }

  let html = '';
  let doneCount = 0;
  assigned.forEach(a => {
    const ex = getExercise(a.exercise_id); if (!ex) return;
    const done = doneNames.has((ex.name || '').trim().toLowerCase());
    if (done) doneCount++;
    const meta = [];
    const sets = a.custom_sets || ex.default_sets;
    const reps = a.custom_reps || ex.default_reps;
    const weight = a.custom_weight || ex.default_weight;
    const rest = a.custom_rest || ex.default_rest;
    if (sets && reps) meta.push(`${sets} × ${reps}`);
    if (weight) meta.push(`Weight: ${weight}`);
    if (rest) meta.push(`Rest: ${rest}`);
    html += `<div class="plan-card ${done ? 'done' : ''}">
      <div class="plan-card-main">
        <div class="plan-card-name">${escapeHtml(ex.name)}</div>
        <div class="plan-card-meta">
          ${meta.map(m => `<span class="plan-chip">${escapeHtml(String(m))}</span>`).join('')}
          ${ex.category ? `<span class="plan-chip subtle">${escapeHtml(ex.category)}</span>` : ''}
          ${ex.muscle_group ? `<span class="plan-chip subtle">${escapeHtml(ex.muscle_group)}</span>` : ''}
        </div>
        ${a.custom_notes ? `<div class="plan-card-note">📝 ${escapeHtml(a.custom_notes)}</div>` : ''}
      </div>
      <div class="plan-card-status">${done ? '<span class="history-pill done">✅ Done in a finished session</span>' : '<span class="history-pill open">⏳ Not completed yet</span>'}</div>
    </div>`;
  });
  const pct = assigned.length ? Math.round((doneCount / assigned.length) * 100) : 0;
  container.innerHTML = `
    <div class="plan-progress-head">
      <span><strong>${doneCount}</strong> of <strong>${assigned.length}</strong> plan exercises completed in finished sessions</span>
      <button class="btn-secondary btn-small" id="clientViewScheduleBtn">📅 View my schedule</button>
    </div>
    <div class="plan-progress-bar"><div class="plan-progress-fill" style="width:${pct}%"></div></div>
    ${html}`;
  const vs = $('clientViewScheduleBtn');
  if (vs) vs.addEventListener('click', () => {
    const first = document.querySelector('#clientUpcomingList .client-upcoming-item[data-date]');
    if (first) openClientDayLog(first.dataset.date);
    else showToast('📅 No scheduled days yet — your trainer will set them soon.', 'info');
  });
};

// ============================================================
// 👤 MY PROFILE — ONE merged editable form (view + edit unified)
// ------------------------------------------------------------
// The old split UX showed a read-only grid (Height / Gender / Birth date /
// Goal / Medical notes / Emergency contact) PLUS a separate "✏️ Edit
// Profile" modal containing those same fields AGAIN plus the 📌 Shared
// Inputs panel with its own "📩 Save to Profile" button — two forms, two
// buttons, two approval flows for the same data.
// NOW: everything lives in this single inline form inside 👤 My Profile:
//   • basic details (6 fields) + the 11 📌 Shared Inputs in ONE grid,
//   • one "📩 Save to Profile" button submits ALL of them together as a
//     single profile approval for the trainer,
//   • typing a Shared Input still updates the 🧮 Calculators tab live
//     (delegated listener in calculators.js) and autosaves to
//     fitness_inputs + localStorage.
// ============================================================
window.renderClientProfile = function (c) {
  const p = clientMapGet(APP_STATE.clientProfiles, c.id) || {};
  const escAttr = (s) => String(s ?? '').replace(/&<>"'/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const setVal = (id, v) => { const el = $(id); if (el) el.value = (v == null ? '' : String(v)); };

  // ---------- shared-input controls (the 11 calculator fields) ----------
  // 🎨 Styled EXACTLY like the 👤 Basic Details text boxes above (plain
  // portal inputs/selects — no dark "calc-input" theme), so every field is
  // fully visible in both light and dark themes.
  // 📌 The fields START EMPTY: nothing is pre-filled from localStorage or
  // fitness_inputs. Only values that are already APPROVED on the cloud
  // profile (fit_* columns, written by js/approvals.js) appear here.
  const calcFields = Array.isArray(window.CALC_SHARED_FIELDS) ? window.CALC_SHARED_FIELDS : [];
  const approvedStats = (typeof window.profileHasCalcStats === 'function' &&
    window.profileHasCalcStats(p) && typeof window.profileCalcStats === 'function')
    ? window.profileCalcStats(p) : {};
  let sharedHtml = '';
  calcFields.forEach(f => {
    const [key, label, type, step] = f;
    const id = 'pcx-' + key;
    const av = approvedStats[key];
    let control;
    if (Array.isArray(type)) {
      control = `<select id="${id}" data-fitkey="${key}" data-calcscope="client">` +
        `<option value="">— select —</option>` +
        type.map(o => `<option${String(av) === String(o) ? ' selected' : ''}>${escAttr(o)}</option>`).join('') +
        '</select>';
    } else {
      control = `<input type="number" id="${id}" data-fitkey="${key}" data-calcscope="client" step="${step}" min="0" inputmode="decimal"` +
        ` placeholder="Enter ${escAttr(String(label).replace(/\s*\(.*\)/, ''))}"` +
        ` value="${(av === undefined || av === null) ? '' : escAttr(av)}">`;
    }
    sharedHtml += `<div class="input-group"><label for="${id}">${escAttr(label)}</label>${control}</div>`;
  });

  // ---------- approval status chip (⏳ pending / ✅ approved / ✍️ not submitted) ----------
  const latestProfAp = (APP_STATE.profileApprovals || [])
    .find(a => sameId(a.client_id, c.id));   // list is ordered newest-first
  const profPending = !!(latestProfAp && latestProfAp.status === 'pending');
  const hasApprovedProfile = window.profileHasApprovedData
    ? window.profileHasApprovedData(p)
    : (window.profileHasCalcStats ? window.profileHasCalcStats(p) : false);
  let profStatusChip;
  if (profPending) {
    profStatusChip = `<span class="profile-status-chip profile-status-pending">⏳ Your latest submission is waiting for trainer approval — calculators stay blank until it is approved.</span>`;
  } else if (hasApprovedProfile) {
    profStatusChip = `<span class="profile-status-chip profile-status-approved">✅ Approved profile · updated ${escAttr((p.approved_at || p.updated_at || '').slice(0, 10) || 'recently')} — these values power all 15 calculators.</span>`;
  } else {
    profStatusChip = `<span class="profile-status-chip profile-status-none">✍️ No approved data yet — fill this form and press “📩 Save to Profile”. Until your trainer approves it, the 🧮 Calculators show no results.</span>`;
  }

  // ---------- ONE merged form: basic details + shared inputs together ----------
  let html = `
  ${profStatusChip}
  <div class="profile-shared-hint">✍️ Everything below is ONE form — edit your details and the 📌 Shared Inputs together, then press “📩 Save to Profile”. ALL items are sent to your trainer for approval at once. The 🧮 Calculators tab shows your values only AFTER your trainer approves them.</div>
  <form id="profileEditForm" autocomplete="off" onsubmit="return false;">
    <div class="profile-calc-divider">👤 Basic Details <span>— sent for approval &amp; reviewed by your trainer</span></div>
    <div class="profile-calc-grid">
      <div class="input-group"><label for="pfHeight">Height (cm)</label><input type="number" id="pfHeight" step="0.1" min="0" inputmode="decimal" placeholder="175"></div>
      <div class="input-group"><label for="pfGender">Gender</label><input type="text" id="pfGender" placeholder="Male / Female"></div>
      <div class="input-group"><label for="pfBirth">Birth date</label><input type="date" id="pfBirth"></div>
      <div class="input-group"><label for="pfGoal">Goal</label><input type="text" id="pfGoal" placeholder="Lose 5kg, gain muscle, etc."></div>
      <div class="input-group"><label for="pfMedical">Medical notes</label><input type="text" id="pfMedical" placeholder="Any injuries or conditions"></div>
      <div class="input-group"><label for="pfEmergency">Emergency contact</label><input type="text" id="pfEmergency" placeholder="Name + phone"></div>
    </div>
    ${sharedHtml ? `
    <div class="profile-calc-divider">📌 Shared Inputs <span>— entered once, used by all 15 calculators after approval</span>
      <span class="profile-shared-note hidden" id="profileSharedNote"></span>
    </div>
    <div class="profile-shared-inputs profile-calc-grid" id="profileSharedInputs">${sharedHtml}</div>` : `
    <div class="profile-calc-empty">📌 Shared Inputs unavailable — reload the page. These 11 details are entered once here and used by all 15 calculators.</div>`}
    <div class="modal-actions" style="margin-top:0.9rem;">
      <button type="button" class="btn-admin" id="pcxSubmitBtn">📩 Save to Profile</button>
    </div>
    <div id="pcxStatus" class="status-msg"></div>
  </div>`;
  $('clientProfileView').innerHTML = html;

  // ---------- prefill the basic fields from the approved cloud profile ----------
  setVal('pfHeight', p.height_cm);
  setVal('pfGender', p.gender);
  (() => {
    const el = $('pfBirth');
    if (!el) return;
    const s = (p.birth_date == null ? '' : String(p.birth_date)).slice(0, 10);
    el.value = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  })();
  setVal('pfGoal', p.goal);
  setVal('pfMedical', p.medical_notes);
  setVal('pfEmergency', p.emergency_contact);

  // ---------- 📌 Shared Inputs: EMPTY until approved ----------
  // The fields above were rendered straight from the APPROVED fit_* profile
  // columns only. We deliberately do NOT call prefillProfileCalcStats() or
  // loadFitnessInputsFor() here any more — those adopted draft autosaves and
  // demo defaults into the form, so it never started empty. A value appears
  // in these boxes (and in the 🧮 Calculators tab) ONLY after the trainer
  // approves the submission (js/approvals.js writes client_profiles.fit_*).
  const pcxIds = {};
  calcFields.forEach(f => { pcxIds[f[0]] = 'pcx-' + f[0]; });
  if (typeof window.profileHasCalcStats === 'function' && window.profileHasCalcStats(p)) {
    const note = $('profileSharedNote');
    if (note) { note.textContent = '· saved to your cloud profile ✓'; note.classList.remove('hidden'); }
  }
  // Height typed in the basic section feeds the Shared Inputs height live.
  const pfH = $('pfHeight');
  if (pfH) pfH.addEventListener('input', () => {
    const el = $('pcx-height');
    if (el && pfH.value) el.value = pfH.value;
  });
  const submitBtn = $('pcxSubmitBtn');
  if (submitBtn) submitBtn.addEventListener('click', () => submitProfileFromView(c));
};

// Submit the WHOLE merged 👤 My Profile form — basic details AND the 11
// 📌 Shared Inputs — as ONE profile approval, and mirror the shared values
// into fitness_inputs so the Calculators tab reflects them immediately.
async function submitProfileFromView(client) {
  const st = $('pcxStatus');
  const ids = {};
  (Array.isArray(window.CALC_SHARED_FIELDS) ? window.CALC_SHARED_FIELDS : [])
    .forEach(f => { ids[f[0]] = 'pcx-' + f[0]; });
  const gv = (k) => { const el = $(ids[k]); return el ? el.value : ''; };
  const gn = (k) => { const n = parseFloat(gv(k)); return Number.isFinite(n) ? n : null; };
  const gval = (id) => { const el = $(id); return el ? String(el.value || '').trim() : ''; };
  const gnum = (id) => { const n = parseFloat(gval(id)); return Number.isFinite(n) ? n : null; };

  // ---- ONE payload with EVERYTHING (all items approve together) ----
  const proposed = {
    height_cm: gnum('pfHeight') != null ? gnum('pfHeight') : gn('height'),
    gender: gval('pfGender') || gv('gender') || null,
    birth_date: /^\d{4}-\d{2}-\d{2}$/.test(gval('pfBirth')) ? gval('pfBirth') : null,
    goal: gval('pfGoal') || gv('goal') || null,
    medical_notes: gval('pfMedical') || null,
    emergency_contact: gval('pfEmergency') || null,
    fit_weight_kg: gn('weight'), fit_height_cm: gn('height'), fit_age: gn('age'),
    fit_gender: gv('gender') || null, fit_activity_level: gv('activity') || null,
    fit_goal: gv('goal') || null, fit_waist_cm: gn('waist'), fit_neck_cm: gn('neck'),
    fit_hip_cm: gn('hip'), fit_bench_kg: gn('bench'), fit_body_fat_pct: gn('bodyfat')
  };
  const currentP = clientMapGet(APP_STATE.clientProfiles, client.id) || {};
  // Nothing changed? Don't spam the trainer with an empty approval.
  const hasChange = Object.keys(proposed).some(k => {
    const a = proposed[k], b = currentP[k];
    if (a == null && (b == null || b === '')) return false;
    return String(a) !== String(b);
  });
  if (!hasChange) {
    if (st) showStatus(st, 'ℹ️ Nothing to save — your details are unchanged.', 'info');
    return;
  }
  if (st) showStatus(st, '⏳ Saving…', 'info');
  try {
    // 📌 NOTHING touches fitness_inputs / localStorage any more here.
    //    The submission goes ONLY to profile_approvals (status: pending).
    //    On APPROVAL the trainer's js/approvals.js writes the fit_* columns
    //    into client_profiles and syncs them into the calculator hub — that
    //    is the single path by which values "come into the calculator".
    // 🗂️ SNAPSHOT-ON-RE-APPROVAL: before a NEW profile approval is accepted,
    //    js/approvals.js archives the CURRENT approved profile (all details:
    //    basic + shared inputs + last update date) into progress_entries, so
    //    every weekly re-approval builds up a history in 📈 Progress. That
    //    archiving needs the CURRENT approved row available locally, so make
    //    sure it is loaded here (cheap single-row read, best-effort).
    const sb = APP_STATE.supabaseClient;
    if (!sb) {
      if (st) showStatus(st, '⚠️ Offline — nothing was submitted. Re-open the portal while connected and press “📩 Save to Profile” again.', 'info');
      return;
    }
    // 🗂️ Best-effort refresh of the approved profile row (used by the
    //    approval-time snapshot described above). Never blocks submitting.
    try {
      const { data: freshP } = await sb.from('client_profiles')
        .select('*').eq('client_id', String(client.id)).maybeSingle();
      if (freshP) clientMapSet(APP_STATE.clientProfiles, client.id, freshP);
    } catch (e) { /* offline / table missing → local copy still usable */ }
    const { data, error } = await sb.from('profile_approvals')
      .insert({ client_id: client.id, proposed_data: proposed, current_data: currentP, status: 'pending' })
      .select().single();
    if (error && typeof window.isSchemaMissingError === 'function' && window.isSchemaMissingError(error)) {
      // Migration not applied → retry WITHOUT the fit_* stats so the basic
      // profile edit still reaches the trainer.
      Object.keys(proposed).forEach(k => { if (k.startsWith('fit_')) delete proposed[k]; });
      const retry = await sb.from('profile_approvals')
        .insert({ client_id: client.id, proposed_data: proposed, current_data: currentP, status: 'pending' })
        .select().single();
      if (retry.error) throw retry.error;
      (APP_STATE.profileApprovals || []).unshift(retry.data);
      if (st) showStatus(st, '✅ Submitted for approval! ⚠️ Run sql/fitness_calculator.sql to enable calculator body stats.', 'success');
    } else if (error) {
      throw error;
    } else {
      (APP_STATE.profileApprovals || []).unshift(data);
      // 📌 Approval gate ON: mark this client as pending locally so the live
      // typing → calculator preview stays blocked until the trainer decides
      // (even between list refreshes / offline). Cleared by approvals.js on
      // approve/reject and by loadFitnessInputsFor() when the server shows
      // no pending row.
      try { localStorage.setItem('tas_profile_pending:' + String(client.id), '1'); } catch (e) { }
      if (st) showStatus(st, '⏳ Submitted! Your trainer must approve these details before they appear in the 🧮 Calculators.', 'success');
      if (typeof window.showToast === 'function') window.showToast('⏳ Profile submitted — waiting for trainer approval', 'info');
    }
    if (typeof window.syncClientPendingBanner === 'function') window.syncClientPendingBanner();
    if (typeof window.updateApprovalsBadge === 'function') window.updateApprovalsBadge();
    setTimeout(() => { if (st) clearStatus(st); }, 5000);
  } catch (err) {
    if (st) showStatus(st, '❌ ' + err.message, 'error');
  }
}
// Defaults mirror js/calculators.js DEFAULTS (used when merging saves locally).
const DEFAULTS_FALLBACK = {
  weight: 75, height: 175, age: 25, gender: 'Male',
  activity: 'Moderately Active', goal: 'Maintain',
  waist: 85, neck: 38, hip: 95, bench: 80, bodyfat: 15
};
window.__calcDefaults = DEFAULTS_FALLBACK;

window.renderClientUpcoming = function (c) {
  const container = $('clientUpcomingList');
  if (!container) return;
  // Show every scheduled class for the next 14 days — including days whose
  // time the trainer has set AND sessions that were already marked finished,
  // so nothing the trainer scheduled ever disappears from the client view.
  // Days with an APPROVED cancellation are skipped entirely (class gone).
  const items = getScheduledDaysAhead(c.id, 14);
  const today = new Date();
  const todayStr = formatDateISO(today.getFullYear(), today.getMonth(), today.getDate());
  const decidedCancels = {};
  (APP_STATE.clientRequests || []).forEach(r => {
    // BUG FIX: previously ANY non-pending status (approved | rejected) was
    // recorded here, and 'rejected' rows kept rendering stale "Cancel
    // declined" / 🚫 chips on days that no longer exist after a wipe —
    // producing phantom future dates (e.g. "9 October") in every client
    // portal. Only APPROVED cancellations suppress a day; rejected/withdrawn
    // requests are ignored entirely.
    if (sameId(r.client_id, c.id) && r.request_type === 'cancel' && r.session_date && r.status === 'approved') {
      decidedCancels[r.session_date] = 'approved';
    }
  });
  let html = '';
  const visible = items.filter(it => decidedCancels[it.dateStr] !== 'approved');
  if (visible.length === 0) {
    html = `<div class="client-upcoming-empty">📭 No classes scheduled in the next few days yet.<br>
      <span>Your trainer will set your upcoming session times here.</span></div>`;
  } else {
    visible.forEach(it => {
      const isToday = it.dateStr === todayStr;
      const timeHtml = it.time
        ? `<span class="client-upcoming-time">⏰ ${formatClassTime12(it.time)}</span>`
        : `<span class="client-upcoming-time-not-set">Time not set yet</span>`;
      let statusHtml = it.done
        ? '<span class="history-pill done">✅ Finished</span>'
        : (isToday ? '<span class="history-pill today">🔥 Today</span>' : '<span class="history-pill open">⏳ Pending</span>');
      const pendEdits = typeof getPendingLogEditsFor === 'function'
        ? getPendingLogEditsFor(c.id, it.dateStr) : [];
      let actionBtn = '';
      if (pendEdits.length > 0) actionBtn += `<span class="lock-status-chip">🕓 ${pendEdits.length} pending</span>`;
      html += `<div class="client-upcoming-item ${it.done ? 'done' : 'open'}" data-date="${it.dateStr}">
        <span class="client-upcoming-icon">${it.done ? '✅' : '📅'}</span>
        <div class="client-upcoming-body">
          <div class="client-upcoming-title-row"><strong>${isToday ? 'Today' : formatDateReadable(it.y, it.m, it.day)}</strong>${statusHtml}</div>
          <div class="client-upcoming-sub">${timeHtml}${it.note ? ` · 📝 ${escapeHtml(it.note)}` : ''}</div>
        </div>
        <div class="client-upcoming-actions">
          <button class="btn-secondary btn-small client-upcoming-open" data-date="${it.dateStr}" title="Read-only view of this day's plan & log">👁 View</button>
          ${actionBtn}
        </div>
      </div>`;
    });
  }
  container.innerHTML = html;
  container.querySelectorAll('.client-upcoming-open').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); openClientDayLog(btn.dataset.date); }));
  container.querySelectorAll('.client-upcoming-item[data-date]').forEach(item =>
    item.addEventListener('dblclick', () => openClientDayLog(item.dataset.date)));

  const rs = clientMapGet(APP_STATE.clientSettings, c.id) || {};
  if (rs.note) {
    $('clientUpcomingNote').textContent = `📝 Note from trainer: ${rs.note}`;
    $('clientUpcomingNote').classList.remove('hidden');
  } else {
    $('clientUpcomingNote').classList.add('hidden');
  }
  $('clientUpcomingBlock').classList.remove('hidden');
};

window.openProgressModal = function (entry, clientId, addedBy) {
  // Guarded opener: every field lookup is optional so a missing/renamed
  // input can never throw before the modal appears (this was the root
  // cause of "➕ Add Entry is not working" in the client portal).
  const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
  APP_STATE.selectedClientForProgress = { clientId, addedBy };
  if (entry) {
    setVal('editProgressId', entry.id);
    const t = $('progressModalTitle'); if (t) t.textContent = '✏️ Edit';
    setVal('pgDate', entry.entry_date || '');
    setVal('pgWeight', entry.weight_kg || '');
    setVal('pgBodyFat', entry.body_fat_pct || '');
    setVal('pgChest', entry.chest_cm || '');
    setVal('pgWaist', entry.waist_cm || '');
    setVal('pgHips', entry.hips_cm || '');
    setVal('pgArms', entry.arms_cm || '');
    setVal('pgThighs', entry.thighs_cm || '');
    setVal('pgNotes', entry.notes || '');
    setVal('pgPhoto', entry.photo_url || '');
  } else {
    setVal('editProgressId', '');
    const t = $('progressModalTitle');
    if (t) t.textContent = addedBy === 'admin' ? '➕ Add (as Admin)' : '➕ Add My Progress';
    setVal('pgDate', new Date().toISOString().split('T')[0]);
    ['pgWeight', 'pgBodyFat', 'pgChest', 'pgWaist', 'pgHips', 'pgArms', 'pgThighs', 'pgNotes', 'pgPhoto']
      .forEach(i => setVal(i, ''));
  }
  const modal = $('progressModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  clearStatus($('progressModalStatus'));
};

window.saveProgress = async function () {
  if (!APP_STATE.selectedClientForProgress) return;
  const { clientId, addedBy } = APP_STATE.selectedClientForProgress;
  const proposed = {
    entry_date: $('pgDate').value || new Date().toISOString().split('T')[0],
    weight_kg: parseFloat($('pgWeight').value) || null,
    body_fat_pct: parseFloat($('pgBodyFat').value) || null,
    chest_cm: parseFloat($('pgChest').value) || null,
    waist_cm: parseFloat($('pgWaist').value) || null,
    hips_cm: parseFloat($('pgHips').value) || null,
    arms_cm: parseFloat($('pgArms').value) || null,
    thighs_cm: parseFloat($('pgThighs').value) || null,
    notes: $('pgNotes').value.trim() || null,
    photo_url: $('pgPhoto').value.trim() || null
  };
  const editId = $('editProgressId').value;
  try {
    $('saveProgressBtn').disabled = true;
    if (addedBy === 'client') {
      const action = editId ? 'edit' : 'add';
      let currentData = null;
      if (editId) currentData = (clientMapGet(APP_STATE.progressEntries, clientId) || []).find(x => String(x.id) === String(editId)) || null;
      const payload = {
        client_id: clientId, action, entry_id: editId || null,
        proposed_data: { ...proposed, added_by: 'client' },
        current_data: currentData, status: 'pending'
      };
      const { data, error } = await APP_STATE.supabaseClient.from('progress_approvals').insert(payload).select().single();
      if (error) throw error;
      APP_STATE.progressApprovals.unshift(data);
      $('progressModal').classList.add('hidden');
      updateApprovalsBadge();
      if (APP_STATE.loggedInClient && sameId(APP_STATE.loggedInClient.id, clientId)) {
        renderClientProgress(APP_STATE.loggedInClient);
        if (typeof window.syncClientPendingBanner === 'function') window.syncClientPendingBanner();
        else $('clientPendingBanner').classList.remove('hidden');
      }
      showStatus($('progressModalStatus'), '✅ Submitted for admin approval!', 'success');
    } else {
      const payload = { client_id: clientId, added_by: 'admin', ...proposed };
      if (editId) {
        const { error } = await APP_STATE.supabaseClient.from('progress_entries').update(payload).eq('id', editId);
        if (error) throw error;
        const arr = clientMapGet(APP_STATE.progressEntries, clientId) || [];
        const idx = arr.findIndex(x => String(x.id) === String(editId));
        if (idx >= 0) arr[idx] = { ...arr[idx], ...payload };
      } else {
        const { data, error } = await APP_STATE.supabaseClient.from('progress_entries').insert(payload).select().single();
        if (error) throw error;
        const list = clientMapGet(APP_STATE.progressEntries, clientId) || [];
        list.unshift(data);
        clientMapSet(APP_STATE.progressEntries, clientId, list);
      }
      (clientMapGet(APP_STATE.progressEntries, clientId) || []).sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''));
      $('progressModal').classList.add('hidden');
      if (sameId(APP_STATE.selectedClientId, clientId)) renderAdminProgress();
    }
  } catch (err) {
    showStatus($('progressModalStatus'), '❌ ' + err.message, 'error');
  } finally {
    $('saveProgressBtn').disabled = false;
  }
};

// ============================================================
// LEGACY ✏️ Edit Profile modal — REMOVED. The profile form is now the
// single merged inline editor inside 👤 My Profile (see
// renderClientProfile + submitProfileFromView above). This shim keeps
// any stale call-sites working by routing them to the one real flow:
// switch to the Profile tab and press the merged form's "📩 Save to
// Profile" button, so ALL items are still submitted for approval at
// once through a single code path.
// ============================================================
window.submitProfileEdit = async function () {
  const tabBtn = document.querySelector('.tab-btn[data-ctab="profile"]');
  if (tabBtn) { try { tabBtn.click(); } catch (e) {} }
  const btn = document.getElementById('pcxSubmitBtn');
  if (btn) { btn.click(); return; }
  if (typeof window.showToast === 'function') {
    window.showToast('👤 Use “📩 Save to Profile” in My Profile — all details are submitted together there.', 'info');
  }
};

// ============================================================
// 🔄 WEEKLY PROFILE UPDATE REMINDER — auto popup, once a week
// ------------------------------------------------------------
// Once a client's profile is approved, ALL calculators run from those
// approved values. To keep the numbers fresh, this popup automatically
// asks the client to review & re-submit their profile every 7 days:
//   • shows only for signed-in clients whose LAST approval is ≥ 7 days old,
//   • appears at most once per week per client (localStorage timestamp),
//   • "Update my profile" jumps to 👤 My Profile and focuses the form,
//   • "Later" snoozes it for another 24 hours so it isn't naggy.
// The modal markup lives at the bottom of index.html (#weeklyProfileModal).
// ============================================================
const WEEKLY_PROFILE_LS = 'tas_weekly_profile_popup_v1:';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// True when the approved profile row carries ANY real data (basic fields
// or fit_* shared inputs) — used by the status chip + weekly reminder.
window.profileHasApprovedData = function (p) {
  if (!p) return false;
  if (typeof window.profileHasCalcStats === 'function' && window.profileHasCalcStats(p)) return true;
  return ['height_cm', 'gender', 'birth_date', 'goal', 'medical_notes', 'emergency_contact']
    .some(k => p[k] !== null && p[k] !== undefined && String(p[k]).trim() !== '');
};

// Timestamp (ms) of the client's most recent APPROVED profile submission.
window.getLastProfileApprovalTime = function (clientId) {
  let last = 0;
  try {
    (APP_STATE.profileApprovals || []).forEach(a => {
      if (!sameId(a.client_id, clientId)) return;
      if (a.status !== 'approved') return;
      const t = Date.parse(a.decided_at || a.submitted_at || '');
      if (Number.isFinite(t) && t > last) last = t;
    });
  } catch (e) { }
  return last;
};

window.shouldShowWeeklyProfileReminder = function (c) {
  if (!c) return false;
  const p = clientMapGet(APP_STATE.clientProfiles, c.id) || {};
  // Brand-new clients with nothing approved yet already see the big
  // "✍️ No approved data yet" banner on the Profile tab — no popup needed.
  if (!window.profileHasApprovedData(p)) return false;
  // Don't nag while an update is already sitting in the trainer's queue.
  const pendingProfile = (APP_STATE.profileApprovals || [])
    .some(a => sameId(a.client_id, c.id) && a.status === 'pending');
  if (pendingProfile) return false;
  const lastPopupTs = Number(localStorage.getItem(WEEKLY_PROFILE_LS + String(c.id)) || 0);
  return (Date.now() - lastPopupTs) >= WEEK_MS;
};

window.openWeeklyProfileReminder = function () {
  const m = $('weeklyProfileModal');
  if (m) m.classList.remove('hidden');
};
window.closeWeeklyProfileReminder = function (snooze) {
  const m = $('weeklyProfileModal');
  if (m) m.classList.add('hidden');
  const c = APP_STATE.loggedInClient;
  if (!c) return;
  try {
    // "Later" pushes the popup forward by one day; "Update now" marks the
    // full 7-day cycle as answered (the new approval resets nothing — the
    // next nudge comes a week after this one either way).
    const ts = snooze ? (Date.now() - WEEK_MS + DAY_MS) : Date.now();
    localStorage.setItem(WEEKLY_PROFILE_LS + String(c.id), String(ts));
  } catch (e) { }
};

window.checkWeeklyProfileReminder = function () {
  const c = APP_STATE.loggedInClient;
  if (!c) return;
  if (!window.shouldShowWeeklyProfileReminder(c)) return;
  window.openWeeklyProfileReminder();
};

// Wire the popup buttons once (markup ships in index.html).
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || !t.closest) return;
  if (t.closest('#wprUpdateBtn')) {
    e.preventDefault();
    window.closeWeeklyProfileReminder(false);
    const tabBtn = document.querySelector('.tab-btn[data-ctab="profile"]');
    if (tabBtn) { try { tabBtn.click(); } catch (err) { } }
    setTimeout(() => {
      const first = $('pfHeight') || $('pcx-weight');
      if (first) { try { first.focus(); } catch (err) { } }
    }, 250);
    if (typeof window.showToast === 'function') {
      window.showToast('👤 Review your details and press “📩 Save to Profile” — your trainer will approve the update.', 'info');
    }
  } else if (t.closest('#wprLaterBtn')) {
    e.preventDefault();
    window.closeWeeklyProfileReminder(true);
  } else if (t.closest('#wprCloseX')) {
    e.preventDefault();
    window.closeWeeklyProfileReminder(true);
  }
});

// Trigger points: right after login (auth.js → renderClientDashboard) and
// then hourly while the portal stays open (catches the exact moment a week
// rolls over without hammering the user).
(function scheduleWeeklyReminder() {
  const tryShow = () => { try { window.checkWeeklyProfileReminder(); } catch (e) { } };
  setInterval(tryShow, 60 * 60 * 1000);   // hourly
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(tryShow, 3000);  // returning to the tab
  });
  // Login fires before the approvals/profile fetch completes, so give the
  // data one more short beat before deciding whether to show the popup.
  setTimeout(tryShow, 2500);
})();
