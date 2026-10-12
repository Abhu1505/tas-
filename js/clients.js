window.renderClientList = function () {
  const container = $('clientListContainer');
  if (!container) return;
  const searchEl = $('clientSearchInput');
  // Normalize the query to lowercase so case-insensitive matching works
  // even when the user types an uppercase login ID (e.g. "ALI-9786").
  const q = (searchEl && searchEl.value || '').trim().toLowerCase();
  const countEl = $('clientSearchCount');

  if (APP_STATE.clients.length === 0) {
    container.innerHTML = `<div class="empty-message">No clients yet — create your first client above.</div>`;
    if (countEl) countEl.textContent = '';
    return;
  }
  const filtered = !q ? APP_STATE.clients : APP_STATE.clients.filter(c =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.login_id || '').toLowerCase().includes(q) ||
    (c.phone || '').includes(q) ||
    (c.email || '').toLowerCase().includes(q));
  if (countEl) countEl.textContent = q ? `${filtered.length} of ${APP_STATE.clients.length}` : `${APP_STATE.clients.length} total`;
  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-message">No clients match “${escapeHtml(q)}”.</div>`;
    return;
  }
  let html = '';
  // True-pending lookup — the ⏳ chip only shows for genuine pending rows.
  const trueCounts = window.getTruePendingCounts ? window.getTruePendingCounts() : null;
  filtered.forEach(c => {
    const rate = getRate(c.id);
    const s = clientMapGet(APP_STATE.clientSettings, c.id) || {};
    const isClosed = !c.active;
    const hasPending = trueCounts
      ? (trueCounts.perClient[String(c.id)] || { total: 0 }).total > 0
      : (APP_STATE.profileApprovals.some(a => sameId(a.client_id, c.id) && a.status === 'pending')
        || APP_STATE.progressApprovals.some(a => sameId(a.client_id, c.id) && a.status === 'pending'));
    html += `<div class="client-item ${sameId(APP_STATE.selectedClientId, c.id) ? 'active-client' : ''} ${isClosed ? 'closed-client' : ''} ${hasPending ? 'has-pending' : ''}" data-client-id="${c.id}">
      <div class="client-info">
        <span class="client-name">${escapeHtml(c.name)}</span>
        <span class="client-email">${escapeHtml(c.email || '—')} · ${APP_CONFIG.CURRENCY} ${rate}/session</span>
        ${(s && s.gym_name) ? `<span class="client-email" style="display:block;">🏢 ${escapeHtml(s.gym_name)}${s.gym_branch ? ' · ' + escapeHtml(s.gym_branch) : ''}</span>` : ''}
      </div>
      <div class="client-badges">
        ${hasPending ? `<span class="client-pending-badge">⏳ Pending</span>` : ''}
        ${isClosed ? `<span class="client-status-badge-closed">Closed</span>` :
          `<span class="client-login-badge">🆔 ${escapeHtml(c.login_id)}</span>
           <span class="client-phone-badge">📱 ${escapeHtml(c.phone || '—')}</span>`}
      </div>
    </div>`;
  });
  $('clientListContainer').innerHTML = html;
  document.querySelectorAll('.client-item').forEach(item =>
    item.addEventListener('click', () => selectClient(item.dataset.clientId)));
};

window.selectClient = function (clientId) {
  const c = getClient(clientId); if (!c) return;
  // Store the canonical id from the record so later strict comparisons
  // (e.g. selectedClientId === a.client_id) keep working.
  APP_STATE.selectedClientId = c.id;
  APP_STATE.selectedDay = null;
  document.querySelectorAll('.client-item').forEach(el =>
    el.classList.toggle('active-client', sameId(el.dataset.clientId, c.id)));
  $('clientDetailPanel').classList.remove('hidden');
  $('noClientSelectedMsg').classList.add('hidden');
  $('detailClientName').textContent = c.name;
  $('detailClientLogin').textContent = c.login_id;
  $('detailClientPass').textContent = c.password_hint;
  $('reminderClientNameInline').textContent = c.name;
  $('reminderPhoneDisplay').textContent = c.phone || '—';
  $('ratePerSession').value = getRate(c.id);
  updateClientStatusUI(c);
  initCredentialCopyButtons();
  const rs = clientMapGet(APP_STATE.clientSettings, c.id) || {};
  $('reminderNote').value = rs.note || '';
  document.querySelectorAll('.tab-btn[data-tab]').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === 'reminder'));
  document.querySelectorAll('.tab-content[id^="tab-"]').forEach(t =>
    t.classList.toggle('hidden', t.id !== 'tab-reminder'));
  renderSessions();
  renderAssignList();
  renderAdminProgress();
  updateReminderPreview();
};

window.updateClientStatusUI = function (c) {
  const isClosed = !c.active;
  $('detailClientStatusPill').classList.toggle('hidden', !isClosed);
  $('closedClientBanner').classList.toggle('hidden', !isClosed);
  $('closeClientBar').classList.toggle('hidden', isClosed);
};

window.createClient = async function () {
  const name = $('newClientName').value.trim();
  const phone = $('newClientPhone').value.trim().replace(/\D/g, '');
  const email = $('newClientEmail').value.trim() || null;
  const rate = parseFloat($('newClientRate').value) || 200;
  // 🏢 Gym / Club tab fields (optional — stored in client_settings)
  const gymName = $('newClientGym') ? $('newClientGym').value.trim() : '';
  const gymBranch = $('newClientGymBranch') ? $('newClientGymBranch').value.trim() : '';
  const gymNote = $('newClientGymNote') ? $('newClientGymNote').value.trim() : '';
  if (!name) { showStatus($('createClientStatus'), 'Name required.', 'error'); return; }
  if (!phone) { showStatus($('createClientStatus'), '⚠️ WhatsApp number required.', 'error'); return; }
  const loginId = generateLoginId(name, phone);
  const password = generatePassword(name);
  try {
    $('createClientBtn').disabled = true;
    const { data: newC, error: cErr } = await APP_STATE.supabaseClient
      .from('clients')
      .insert({ login_id: loginId, name, email, phone, password_hint: password, active: true })
      .select().single();
    if (cErr) throw cErr;
    const settingsRow = { client_id: newC.id, rate_aed: rate, note: '' };
    // Only attach gym columns when provided, so databases that haven't run
    // the gym migration (sql/fitness_module.sql §3) keep working.
    if (gymName) settingsRow.gym_name = gymName;
    if (gymBranch) settingsRow.gym_branch = gymBranch;
    if (gymNote) settingsRow.gym_note = gymNote;
    try {
      const { error: sErr } = await APP_STATE.supabaseClient.from('client_settings').insert(settingsRow);
      if (sErr && (gymName || gymBranch || gymNote)) {
        // Older schema without gym columns — retry without them.
        delete settingsRow.gym_name; delete settingsRow.gym_branch; delete settingsRow.gym_note;
        const { error: sErr2 } = await APP_STATE.supabaseClient.from('client_settings').insert(settingsRow);
        if (sErr2) throw sErr2;
        showToast('ℹ️ Saved without gym fields — run sql/fitness_module.sql once to enable the 🏢 Gym columns.', 'warning', 6000);
      } else if (sErr) throw sErr;
    } catch (e) { console.warn('client_settings insert:', e && e.message); }
    APP_STATE.clients.push(newC);
    APP_STATE.clientSettings[newC.id] = { ...settingsRow };
    renderClientList();
    selectClient(newC.id);
    $('newClientCredsLogin').textContent = loginId;
    $('newClientCredsPass').textContent = password;
    $('newClientCredsBox').classList.remove('hidden');
    initCredentialCopyButtons();
    $('newClientName').value = '';
    $('newClientPhone').value = '';
    $('newClientEmail').value = '';
    if ($('newClientGym')) $('newClientGym').value = '';
    if ($('newClientGymBranch')) $('newClientGymBranch').value = '';
    if ($('newClientGymNote')) $('newClientGymNote').value = '';
    updateGymNameSuggestions();
    showStatus($('createClientStatus'), `✅ Client "${name}" created!`, 'success');
    [$('newClientCredsLogin'), $('newClientCredsPass')].forEach(el => {
      el.classList.add('copyable');
      el.title = 'Click to copy';
      el.onclick = () => copyToClipboard(el.textContent.trim(), 'Credentials copied');
    });
    setTimeout(() => clearStatus($('createClientStatus')), 4000);
  } catch (err) {
    showStatus($('createClientStatus'), `❌ ${err.message}`, 'error');
  } finally {
    $('createClientBtn').disabled = false;
  }
};

window.closeSelectedClient = async function () {
  if (!APP_STATE.selectedClientId) return;
  const c = getClient(APP_STATE.selectedClientId); if (!c) return;
  if (!await uiConfirm({ title: 'Close Client', message: `Close account for ${c.name}?\nThey will not be able to log in or receive reminders.`, confirmText: '🔒 Close Account', danger: true })) return;
  try {
    await APP_STATE.supabaseClient.from('clients').update({ active: false }).eq('id', APP_STATE.selectedClientId);
    c.active = false;
    updateClientStatusUI(c);
    renderClientList();
    document.querySelectorAll('.client-item').forEach(el =>
      el.classList.toggle('active-client', sameId(el.dataset.clientId, APP_STATE.selectedClientId)));
  } catch (err) { showStatus(null, '❌ Failed: ' + err.message, 'error'); }
};

window.reopenSelectedClient = async function () {
  if (!APP_STATE.selectedClientId) return;
  const c = getClient(APP_STATE.selectedClientId); if (!c) return;
  if (!await uiConfirm({ title: 'Reopen Client', message: `Reopen account for ${c.name}? They will be able to log in again.`, confirmText: '🔓 Reopen' })) return;
  try {
    await APP_STATE.supabaseClient.from('clients').update({ active: true }).eq('id', APP_STATE.selectedClientId);
    c.active = true;
    updateClientStatusUI(c);
    renderClientList();
    document.querySelectorAll('.client-item').forEach(el =>
      el.classList.toggle('active-client', sameId(el.dataset.clientId, APP_STATE.selectedClientId)));
  } catch (err) { showStatus(null, '❌ Failed: ' + err.message, 'error'); }
};

// Delete a client EVERYWHERE — cloud first, then local caches.
// BUG FIX: previously only the `clients` row was deleted from Supabase, so all
// the related rows (settings, profile, progress, sessions, workout logs,
// daily times, exercises, approvals, requests, reports) stayed in the cloud and
// "the data came back" after the next sync / refresh / reopen on another
// device. Now every table that references this client is wiped for good.
window.confirmDeleteClient = async function () {
  if (!APP_STATE.pendingDeleteClientId) return;
  const btn = $('confirmDeleteClientBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Deleting...';
  const id = APP_STATE.pendingDeleteClientId;
  try {
    const sb = APP_STATE.supabaseClient;

    // Resolve the client's login_id badge too — older rows in some tables may
    // still reference the client by "ALI-9786"-style login id instead of uuid.
    const gone = APP_STATE.clients.find(x => sameId(x.id, id));
    const loginId = gone ? String(gone.login_id || '').trim() : '';

    // Cloud delete per table. A missing/renamed table must not abort the rest
    // of the cascade, so each failure is logged and swallowed.
    const delBy = async (table, col, val) => {
      try { await sb.from(table).delete().eq(col, val); }
      catch (e) { console.warn(`delete client: table ${table} skipped`, e); }
    };
    const delFor = async (table, val) => {
      await delBy(table, 'client_id', val);
      if (loginId && String(loginId) !== String(val)) await delBy(table, 'client_id', loginId);
    };

    await delFor('progress_approvals', id);
    await delFor('profile_approvals', id);
    await delFor('daily_times', id);
    await delFor('progress_entries', id);
    await delFor('workout_logs', id);
    await delFor('client_exercises', id);
    await delFor('sessions', id);
    await delFor('client_requests', id);
    await delFor('workout_edit_requests', id);
    await delFor('progress_reports', id);
    // 🧮 Calculator hub saved inputs for this client (+ local cache).
    if (typeof window.deleteFitnessInputsFor === 'function') {
      try { await window.deleteFitnessInputsFor(id, loginId); } catch (e) { console.warn('delete client: fitness_inputs skipped', e); }
    }
    await delFor('client_profiles', id);
    await delFor('client_settings', id);
    await delBy('clients', 'id', id);
    // sameId-based filtering/deletion so numeric vs string ids never mismatch
    APP_STATE.clients = APP_STATE.clients.filter(x => !sameId(x.id, id));
    const k = Object.keys(APP_STATE.clientSettings).find(key => sameId(key, id));
    if (k !== undefined) delete APP_STATE.clientSettings[k];
    const kp = Object.keys(APP_STATE.clientProfiles).find(key => sameId(key, id));
    if (kp !== undefined) delete APP_STATE.clientProfiles[kp];
    const ke = Object.keys(APP_STATE.progressEntries).find(key => sameId(key, id));
    if (ke !== undefined) delete APP_STATE.progressEntries[ke];
    const kx = Object.keys(APP_STATE.clientExercisesCache).find(key => sameId(key, id));
    if (kx !== undefined) delete APP_STATE.clientExercisesCache[kx];
    const kt = Object.keys(APP_STATE.dailyTimesCache).find(key => sameId(key, id));
    if (kt !== undefined) delete APP_STATE.dailyTimesCache[kt];
    APP_STATE.profileApprovals = APP_STATE.profileApprovals.filter(a => !sameId(a.client_id, id));
    APP_STATE.progressApprovals = APP_STATE.progressApprovals.filter(a => !sameId(a.client_id, id));
    Object.keys(APP_STATE.sessionCache).forEach(sk => { if (sk.startsWith(id + '-')) delete APP_STATE.sessionCache[sk]; });
    Object.keys(APP_STATE.workoutLogsCache).forEach(wk => { if (wk.startsWith(id + '-')) delete APP_STATE.workoutLogsCache[wk]; });
    if (sameId(APP_STATE.selectedClientId, id)) {
      APP_STATE.selectedClientId = null;
      $('clientDetailPanel').classList.add('hidden');
      $('noClientSelectedMsg').classList.remove('hidden');
    }
    renderClientList();
    updateApprovalsBadge();
    showStatus($('deleteClientStatus'), `✅ Deleted.`, 'success');
    setTimeout(() => {
      $('deleteClientModal').classList.add('hidden');
      APP_STATE.pendingDeleteClientId = null;
    }, 1500);
  } catch (err) {
    showStatus($('deleteClientStatus'), `❌ ${err.message}`, 'error');
    btn.disabled = false;
  } finally {
    btn.textContent = '🗑️ Delete';
  }
};

window.showMonthSummary = function () {
  if (!APP_STATE.selectedClientId) return;
  const c = getClient(APP_STATE.selectedClientId);
  const [y, m] = getViewYearMonth();
  $('monthSummarySubtitle').textContent = `${c.name} · ${getMonthName(m)} ${y}`;
  const datesInMonth = [];
  Object.keys(APP_STATE.workoutLogsCache).forEach(k => {
    if (!k.startsWith(APP_STATE.selectedClientId + '-')) return;
    const ds = k.substring(APP_STATE.selectedClientId.length + 1);
    const parts = ds.split('-');
    if (parseInt(parts[0]) === y && (parseInt(parts[1]) - 1) === m) datesInMonth.push(ds);
  });
  datesInMonth.sort().reverse();
  if (datesInMonth.length === 0) {
    $('monthSummaryContent').innerHTML = `<div class="empty-message">No workouts logged this month yet.</div>`;
    $('monthSummaryModal').classList.remove('hidden');
    return;
  }
  let totalEx = 0;
  let html = '';
  datesInMonth.forEach(ds => {
    const logs = APP_STATE.workoutLogsCache[`${APP_STATE.selectedClientId}-${ds}`] || [];
    if (logs.length === 0) return;
    totalEx += logs.length;
    const parts = ds.split('-');
    const dateLabel = formatDateReadable(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    let exHtml = '';
    logs.forEach(log => {
      const name = getWorkoutDisplayName(log);
      const d = [];
      if (log.sets_done) d.push(`${log.sets_done}×`);
      if (log.reps_done) d.push(log.reps_done);
      if (log.weight_done) d.push(`@ ${log.weight_done}`);
      if (log.rest_done) d.push(`rest ${log.rest_done}`);
      exHtml += `<div class="month-summary-ex"><span class="month-summary-ex-name">${escapeHtml(name)}</span><span class="month-summary-ex-detail">${escapeHtml(d.join(' ') || '—')}</span></div>`;
    });
    html += `<div class="month-summary-day"><div class="month-summary-date"><span>📅 ${dateLabel}</span><span class="month-summary-count">${logs.length} exercise${logs.length > 1 ? 's' : ''}</span></div>${exHtml}</div>`;
  });
  html = `<div class="day-log-meta" style="background:#e1f5fe;color:#01579b;">📊 ${datesInMonth.length} workout day${datesInMonth.length > 1 ? 's' : ''} · ${totalEx} total exercise${totalEx > 1 ? 's' : ''}</div>` + html;
  $('monthSummaryContent').innerHTML = html;
  $('monthSummaryModal').classList.remove('hidden');
};

// ---- Professional extras: credential copy buttons & one-time toast ----
window.initCredentialCopyButtons = function () {
  [['detailClientLogin', 'settingsLoginId'], ['detailClientPass', null]].forEach(([id]) => {
    const valueEl = $(id);
    if (!valueEl || valueEl.dataset.copyWired === '1') return;
    valueEl.dataset.copyWired = '1';
    valueEl.classList.add('copyable');
    valueEl.title = 'Click to copy';
    valueEl.addEventListener('click', () => copyToClipboard(valueEl.textContent.trim(), id === 'detailClientPass' ? 'Password copied' : 'Login ID copied'));
  });
};

window.copyToClipboard = async function (text, label = 'Copied') {
  if (!text) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    showToast(`📋 ${label} to clipboard`, 'success', 2500);
  } catch (e) {
    showToast('⚠️ Copy failed — select the text manually.', 'warning');
  }
};

// 🏢 Keep the gym-name datalist (autocomplete suggestions) up to date with
// every gym already saved in client_settings.
window.updateGymNameSuggestions = function () {
  const dl = $('gymNameList');
  if (!dl) return;
  const names = Array.from(new Set(
    Object.values(APP_STATE.clientSettings || {})
      .map(s => (s && s.gym_name || '').trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
  dl.innerHTML = names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
};
