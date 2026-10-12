window.renderSessions = function () {
  if (!APP_STATE.selectedClientId) return;
  const [y, m] = getViewYearMonth();
  const sessions = getSessions(APP_STATE.selectedClientId, y, m);
  const doneDays = sessions.map(s => s.day);
  const checkedTimes = {}; sessions.forEach(s => { checkedTimes[s.day] = s.checked_at; });
  const rate = getRate(APP_STATE.selectedClientId);
  $('summaryRate').textContent = rate;
  $('ratePerSession').value = rate;

  const today = new Date();
  const todayStr = formatDateISO(today.getFullYear(), today.getMonth(), today.getDate());
  const orderedDays = getOrderedDaysForMonth(y, m);

  let html = '';
  for (const day of orderedDays) {
    const isDone = doneDays.includes(day);
    const dow = new Date(y, m, day).toLocaleDateString('en-US', { weekday: 'short' });
    const amount = isDone ? rate : 0;
    const td = checkedTimes[day] ? formatTime12(checkedTimes[day]) : '';
    const isSel = APP_STATE.selectedDay === day;
    const dateStr = formatDateISO(y, m, day);
    const isToday = dateStr === todayStr;
    const dayTime = getTimeForDate(APP_STATE.selectedClientId, dateStr);
    const logs = getWorkoutLogs(APP_STATE.selectedClientId, dateStr);
    const hasWorkout = logs.length > 0;

    let timeHtml = dayTime.isSet
      ? `<div class="session-time-custom">⏰ ${formatClassTime12(dayTime.time)}</div>`
      : `<div class="session-no-time">⏰ No time set</div>`;

    html += `<div class="session-card ${isDone ? 'done' : ''} ${isSel ? 'selected-day' : ''} ${dayTime.isSet ? 'has-custom-time' : ''} ${hasWorkout ? 'has-workout' : ''} ${isToday ? 'is-today' : ''}" data-day="${day}">
      <label><input type="checkbox" class="session-checkbox" data-day="${day}" ${isDone ? 'checked' : ''}> Day ${day}${isToday ? ' <span class="session-today-badge">TODAY</span>' : ''}</label>
      <div class="session-date">${dow}, ${getMonthName(m).slice(0, 3)} ${day}</div>
      ${timeHtml}
      ${isDone && td ? `<div class="session-checked-time">🕐 ${td}</div>` : ''}
      <div class="session-amount">${isDone ? APP_CONFIG.CURRENCY + ' ' + amount : '—'}</div>
      <div class="session-card-footer">
        <span class="session-workout-info">${hasWorkout ? `🏋️ ${logs.length} exercise${logs.length > 1 ? 's' : ''}` : ''}</span>
        <div style="display:flex;gap:0.3rem;">
          <button class="btn-set-time set-day-time-btn" data-day="${day}">⏰ Time</button>
          <button class="btn-add-day view-day-btn" data-day="${day}">📝 Log</button>
        </div>
      </div>
    </div>`;
  }

  $('sessionsGridContainer').innerHTML = html;
  $('summaryDoneCount').textContent = doneDays.length;
  $('summaryTotalAmount').textContent = doneDays.length * rate;

  document.querySelectorAll('.session-checkbox').forEach(cb => {
    cb.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleSession(APP_STATE.selectedClientId, y, m, parseInt(cb.dataset.day, 10), cb.checked);
    });
  });
  document.querySelectorAll('.view-day-btn').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); openDayLogModal(parseInt(btn.dataset.day, 10)); }));
  document.querySelectorAll('.set-day-time-btn').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); openSetTimeModal(parseInt(btn.dataset.day, 10)); }));
};

window.toggleSession = async function (cid, y, m, day, checked) {
  if (!APP_STATE.supabaseClient) { showToast('⏳ Still connecting to the cloud — please wait.', 'warning'); renderSessions(); return; }
  const dateStr = formatDateISO(y, m, day);
  const key = getSessionCacheKey(cid, y, m);
  try {
    if (checked) {
      const { error } = await APP_STATE.supabaseClient
        .from('sessions')
        .upsert({ client_id: cid, session_date: dateStr, checked_at: new Date().toISOString() },
          { onConflict: 'client_id,session_date' });
      if (error) throw error;
      if (!APP_STATE.sessionCache[key]) APP_STATE.sessionCache[key] = [];
      APP_STATE.sessionCache[key] = APP_STATE.sessionCache[key].filter(s => s.day !== day);
      APP_STATE.sessionCache[key].push({ day, checked_at: new Date().toISOString() });
    } else {
      const { error } = await APP_STATE.supabaseClient
        .from('sessions').delete().eq('client_id', cid).eq('session_date', dateStr);
      if (error) throw error;
      if (APP_STATE.sessionCache[key]) APP_STATE.sessionCache[key] = APP_STATE.sessionCache[key].filter(s => s.day !== day);
    }
    renderSessions();
  } catch (err) {
    showStatus(null, '❌ Save failed: ' + err.message, 'error');
    renderSessions();
  }
};

window.openSetTimeModal = function (day) {
  const [y, m] = getViewYearMonth();
  const dateStr = formatDateISO(y, m, day);
  const existing = (clientMapGet(APP_STATE.dailyTimesCache, APP_STATE.selectedClientId) || []).find(d => d.day_date === dateStr);
  $('stDayDate').value = dateStr;
  $('setTimeDateLabel').textContent = formatDateReadable(y, m, day);
  $('stTime').value = existing ? existing.class_time : '07:00';
  $('stNote').value = existing ? (existing.note || '') : '';
  $('setTimeModal').classList.remove('hidden');
  clearStatus($('setTimeStatus'));
};

window.openDayLogModal = function (day) {
  APP_STATE.selectedDay = day;
  const [y, m] = getViewYearMonth();
  const dateStr = formatDateISO(y, m, day);
  $('dayLogDate').value = dateStr;
  $('dayLogDateLabel').textContent = formatDateReadable(y, m, day);
  $('freeExName').value = '';

  // Reset cascading dropdowns
  const catSel = $('libCategorySelect');
  const subSel = $('libSubCategorySelect');
  const exSel  = $('libExerciseSelect');
  if (catSel) catSel.value = '';
  if (subSel) subSel.innerHTML = '<option value="">— Select Sub-category —</option>';
  if (exSel)  exSel.innerHTML  = '<option value="">— Select Exercise —</option>';

  renderDayLogLockState(dateStr);
  renderDayLogExisting(dateStr);
  renderDayLogChips();
  $('dayLogModal').classList.remove('hidden');
  clearStatus($('dayLogStatus'));
};

// --- Day-lock UI ---------------------------------------------------------
// NEW FLOW: clients no longer "send a request for the time". Instead they
// always have an ✏️ Edit option on their own workout log. Every change they
// make is stored as a PROPOSAL (workout_edit_requests.proposed_data) and is
// reflected in the real log ONLY when the admin/trainer approves it.
window.renderDayLogLockState = function (dateStr) {
  const banner = $('dayLogLockBanner');
  const body = $('addExerciseBody');
  const toggle = $('addExerciseToggleBtn');
  if (!banner) return;
  const cid = APP_STATE.loggedInClient ? APP_STATE.loggedInClient.id : APP_STATE.selectedClientId;
  const editable = isDayLogEditable(cid, dateStr);
  const checked = isSessionCheckedForDate(cid, dateStr);

  if (APP_STATE.loggedInClient) {
    // Client portal: the workout log is read-only — the trainer maintains it.
    // Clients request changes via chat / in person.
    if (toggle) toggle.style.display = 'none';
    if (body) body.classList.add('hidden');
    let html = '';
    if (!checked) {
      html += `<div class="day-open-banner">👁 Read-only view of your approved log. Need a change? Ask your trainer.</div>`;
    } else {
      html += `<div class="day-lock-banner"><div class="day-lock-text"><strong>✅ Finished session — official log locked.</strong><br>Need a correction? Ask your trainer to update it.</div></div>`;
    }
    banner.innerHTML = html;
    return;
  }

  // ---- Admin portal ----
  if (editable || !checked) {
    // Pending session (not marked finished) — fully editable.
    banner.innerHTML = '';
    if (toggle) toggle.style.display = '';
    if (body) body.classList.remove('hidden');
    return;
  }
  const actionHtml = `<label class="admin-unlock-toggle"><input type="checkbox" id="adminUnlockDayChk" ${editable ? 'checked' : ''}> 🔓 Unlock for editing</label>`;
  banner.innerHTML = `<div class="day-lock-banner">
      <div class="day-lock-text"><strong>🔒 Session finished — log is locked.</strong><br>
      Use 🔓 Unlock below to make corrections, then lock it again.</div>
      ${actionHtml}
    </div>`;
  if (toggle) toggle.style.display = 'none';
  if (body) body.classList.add('hidden');

  const unlockChk = $('adminUnlockDayChk');
  if (unlockChk) unlockChk.addEventListener('change', () => adminToggleDayUnlock(dateStr, unlockChk.checked));
};

window.adminToggleDayUnlock = async function (dateStr, unlocked) {
  const cid = APP_STATE.selectedClientId;
  if (!cid || !APP_STATE.supabaseClient) { showToast('⏳ Still connecting to the cloud.', 'warning'); return; }
  try {
    const existing = (APP_STATE.workoutEditRequests || []).find(r =>
      String(r.client_id) === String(cid) && r.session_date === dateStr);
    if (existing) {
      const { error } = await APP_STATE.supabaseClient.from('workout_edit_requests')
        .update({ admin_unlocked: unlocked }).eq('id', existing.id);
      if (error) throw error;
      existing.admin_unlocked = unlocked;
    } else {
      const { error } = await APP_STATE.supabaseClient.from('workout_edit_requests')
        .insert({ client_id: cid, session_date: dateStr, status: 'approved', admin_unlocked: unlocked, requested_at: new Date().toISOString() });
      if (error) throw error;
      APP_STATE.workoutEditRequests.push({ client_id: cid, session_date: dateStr, status: 'approved', admin_unlocked: unlocked });
    }
    showToast(unlocked ? '🔓 Day unlocked for editing.' : '🔒 Day locked again.', 'info', 2500);
    renderDayLogLockState(dateStr);
    renderDayLogExisting(dateStr);
  } catch (err) {
    if (window.isMissingTableError(err)) {
      await window.handleMissingWerTable();
      return;
    }
    showStatus($('dayLogStatus'), '❌ ' + err.message, 'error');
  }
};

window.renderDayLogExisting = function (dateStr) {
  const cid = APP_STATE.loggedInClient ? APP_STATE.loggedInClient.id : APP_STATE.selectedClientId;
  const logs = APP_STATE.workoutLogsCache[`${cid}-${dateStr}`] || [];
  const container = $('dayLogExisting');
  // Clients see a read-only view of their official log — the trainer maintains it.
  const isClient = !!APP_STATE.loggedInClient;
  const editable = !isClient && isDayLogEditable(cid, dateStr);
  if (logs.length === 0) {
    container.innerHTML = `<div class="day-log-meta">No exercises logged for this day yet.</div>`;
    return;
  }
  let html = `<div class="day-log-meta">🏋️ ${logs.length} exercise${logs.length > 1 ? 's' : ''} on this day${isClient ? ' · <span class="locked-tag">official values</span>' : (editable ? '' : ' · <span class="locked-tag">🔒 read-only</span>')}</div>`;
  logs.forEach(log => {
    const name = getWorkoutDisplayName(log);
    const lastMatch = getLastLogForExercise(cid, name, log.exercise_id || null, dateStr);
    const lastBanner = lastMatch ? `<div class="last-time-banner">${escapeHtml(formatLastTimeSummary(lastMatch))}</div>` : '';
    const fieldAttr = editable ? '' : 'disabled';
    html += `<div class="exercise-entry ${editable ? '' : 'locked'}" data-log-id="${log.id}">
      <div class="exercise-entry-header">
        <div>
          <div class="exercise-entry-name">${escapeHtml(name)}</div>
          ${log.exercise_name && !log.exercise_id ? `<div class="exercise-entry-meta">Custom entry</div>` : ''}
        </div>
        ${editable ? `<button class="btn-danger-small btn-small remove-log-btn" data-log-id="${log.id}">✖</button>` : '<span class="lock-mini">🔒</span>'}
      </div>
      ${lastBanner}
      <div class="exercise-entry-fields">
        <div class="field"><label>Sets</label><input type="number" class="log-field" data-field="sets_done" value="${log.sets_done || ''}" inputmode="numeric" placeholder="—" ${fieldAttr}></div>
        <div class="field"><label>Reps</label><input type="text" class="log-field" data-field="reps_done" value="${escapeHtml(log.reps_done || '')}" placeholder="—" ${fieldAttr}></div>
        <div class="field"><label>Weight</label><input type="text" class="log-field" data-field="weight_done" value="${escapeHtml(log.weight_done || '')}" placeholder="—" ${fieldAttr}></div>
        <div class="field"><label>Rest</label><input type="text" class="log-field" data-field="rest_done" value="${escapeHtml(log.rest_done || '')}" placeholder="—" ${fieldAttr}></div>
      </div>
      <div class="exercise-notes-row"><input type="text" class="log-field" data-field="notes" value="${escapeHtml(log.notes || '')}" placeholder="Notes" ${fieldAttr}></div>
    </div>`;
  });
  container.innerHTML = html;

  document.querySelectorAll('.log-field').forEach(input => {
    input.addEventListener('change', async (e) => {
      if (APP_STATE.loggedInClient) return; // clients: read-only
      const entry = e.target.closest('.exercise-entry');
      await saveWorkoutLogField(entry.dataset.logId, e.target.dataset.field, e.target.value);
    });
  });
  document.querySelectorAll('.remove-log-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (APP_STATE.loggedInClient) return; // clients: read-only
      if (!await uiConfirm({ title: 'Remove Exercise', message: 'Remove this exercise from the day log?', confirmText: '✖ Remove', danger: true })) return;
      await removeWorkoutLogById(btn.dataset.logId);
      openDayLogModal(APP_STATE.selectedDay);
    });
  });
};

window.renderDayLogChips = function () {
  const chipsContainer = $('libraryQuickChips');
  if (!chipsContainer) return;
  if (APP_STATE.exercises.length === 0) { chipsContainer.innerHTML = ''; return; }
  chipsContainer.innerHTML = APP_STATE.exercises.slice(0, 20)
    .map(ex => `<div class="library-chip" data-ex-id="${ex.id}" data-ex-name="${escapeHtml(ex.name)}">+ ${escapeHtml(ex.name)}</div>`)
    .join('');
  chipsContainer.querySelectorAll('.library-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      await addExerciseToDay({ name: chip.dataset.exName, exercise_id: chip.dataset.exId });
      openDayLogModal(APP_STATE.selectedDay);
    });
  });
};

window.addExerciseToDay = async function (opts) {
  if (APP_STATE.loggedInClient) { showToast('👁 Your schedule is managed by your trainer — use 📨 Request.', 'warning'); return; }
  const dateStr = $('dayLogDate').value;
  if (!dateStr) return;
  // When the client portal opens the log, selectedClientId may be unset —
  // always resolve the target client first so clients can log exercises on
  // their own OPEN (not yet finished) session days.
  const cid = APP_STATE.loggedInClient ? APP_STATE.loggedInClient.id : APP_STATE.selectedClientId;
  if (!cid) { showToast('⚠️ No client selected.', 'warning'); return; }
  APP_STATE.selectedClientId = cid;
  if (!isDayLogEditable(cid, dateStr)) {
    showToast('🔒 This session is finished — the log is locked. Ask your trainer to unlock it.', 'warning');
    return;
  }
  const exerciseName = opts.name;
  const exerciseId = opts.exercise_id || null;
  const last = getLastLogForExercise(cid, exerciseName, exerciseId, dateStr);
  let prefill = { sets_done: null, reps_done: null, weight_done: null, rest_done: null, notes: null };
  if (last && last.log) {
    prefill = {
      sets_done: last.log.sets_done ?? null,
      reps_done: last.log.reps_done ?? null,
      weight_done: last.log.weight_done ?? null,
      rest_done: last.log.rest_done ?? null,
      notes: last.log.notes ?? null
    };
  } else if (exerciseId) {
    const assigned = (clientMapGet(APP_STATE.clientExercisesCache, cid) || []).find(a => sameId(a.exercise_id, exerciseId));
    const libEx = getExercise(exerciseId);
    if (assigned || libEx) {
      prefill.sets_done = assigned?.custom_sets ?? libEx?.default_sets ?? null;
      prefill.reps_done = assigned?.custom_reps ?? libEx?.default_reps ?? null;
      prefill.weight_done = assigned?.custom_weight ?? libEx?.default_weight ?? null;
      prefill.rest_done = assigned?.custom_rest ?? libEx?.default_rest ?? null;
      prefill.notes = assigned?.custom_notes ?? null;
    }
  }
  const payload = {
    client_id: cid,
    session_date: dateStr,
    exercise_id: exerciseId,
    exercise_name: exerciseName,
    ...prefill
  };
  try {
    const { data, error } = await APP_STATE.supabaseClient.from('workout_logs').insert(payload).select().single();
    if (error) throw error;
    const k = `${cid}-${dateStr}`;
    if (!APP_STATE.workoutLogsCache[k]) APP_STATE.workoutLogsCache[k] = [];
    APP_STATE.workoutLogsCache[k].push(data);
    renderSessions();
    refreshClientPortalViews();
  } catch (err) {
    showStatus($('dayLogStatus'), '❌ ' + err.message, 'error');
  }
};

window.saveWorkoutLogField = async function (logId, field, val) {
  if (APP_STATE.loggedInClient) { showToast('👁 Read-only — send a 📨 Request to change your log.', 'warning'); return; }
  try {
    const { error } = await APP_STATE.supabaseClient.from('workout_logs').update({ [field]: val || null }).eq('id', logId);
    if (error) throw error;
    Object.keys(APP_STATE.workoutLogsCache).forEach(k => {
      const arr = APP_STATE.workoutLogsCache[k];
      const idx = arr.findIndex(w => String(w.id) === String(logId));
      if (idx >= 0) arr[idx][field] = val || null;
    });
    refreshClientPortalViews();
  } catch (err) { console.error(err); }
};

window.removeWorkoutLogById = async function (logId) {
  if (APP_STATE.loggedInClient) { showToast('👁 Read-only — send a 📨 Request to change your log.', 'warning'); return; }
  try {
    await APP_STATE.supabaseClient.from('workout_logs').delete().eq('id', logId);
    Object.keys(APP_STATE.workoutLogsCache).forEach(k => {
      APP_STATE.workoutLogsCache[k] = APP_STATE.workoutLogsCache[k].filter(w => String(w.id) !== String(logId));
    });
    renderSessions();
    refreshClientPortalViews();
  } catch (err) { console.error(err); }
};

// Re-render the client portal cards after any workout-log change so what the
// trainer/client just did is visible immediately (plan completion, history…).
window.refreshClientPortalViews = function () {
  const lc = APP_STATE.loggedInClient;
  if (!lc) return;
  renderClientHistory(lc);
  renderClientPlan(lc);
  renderClientUpcoming(lc);
};

window.renderAssignList = function () {
  if (!APP_STATE.selectedClientId) return;
  const assigned = clientMapGet(APP_STATE.clientExercisesCache, APP_STATE.selectedClientId) || [];
  const map = {}; assigned.forEach(a => { map[String(a.exercise_id)] = a; });
  if (APP_STATE.exercises.length === 0) {
    $('assignList').innerHTML = `<div class="empty-message">No exercises in library.</div>`;
    return;
  }
  let html = '';
  APP_STATE.exercises.forEach(ex => {
    const sel = !!map[String(ex.id)];
    const a = map[String(ex.id)] || {};
    html += `<div class="assign-row ${sel ? 'selected' : ''}" data-ex-id="${ex.id}">
      <div class="assign-row-header"><input type="checkbox" class="assign-checkbox" data-ex-id="${ex.id}" ${sel ? 'checked' : ''}>
        <div style="flex:1;min-width:0;"><div class="assign-row-name">${escapeHtml(ex.name)}</div>
          <div class="assign-row-meta">${ex.category ? escapeHtml(ex.category) + ' · ' : ''}${ex.default_sets || '-'} × ${ex.default_reps || '-'}</div></div></div>
      ${sel ? `<div class="assign-custom-fields">
        <div class="field"><label>Sets</label><input type="number" class="assign-field" data-ex-id="${ex.id}" data-field="custom_sets" value="${a.custom_sets ?? ''}" inputmode="numeric"></div>
        <div class="field"><label>Reps</label><input type="text" class="assign-field" data-ex-id="${ex.id}" data-field="custom_reps" value="${escapeHtml(a.custom_reps || '')}"></div>
        <div class="field"><label>Weight</label><input type="text" class="assign-field" data-ex-id="${ex.id}" data-field="custom_weight" value="${escapeHtml(a.custom_weight || '')}"></div>
        <div class="field"><label>Rest</label><input type="text" class="assign-field" data-ex-id="${ex.id}" data-field="custom_rest" value="${escapeHtml(a.custom_rest || '')}"></div>
      </div>
      <div class="exercise-notes-row" style="margin-top:0.5rem;"><input type="text" class="assign-field" data-ex-id="${ex.id}" data-field="custom_notes" value="${escapeHtml(a.custom_notes || '')}" placeholder="Notes"></div>` : ''}
    </div>`;
  });
  $('assignList').innerHTML = html;
  document.querySelectorAll('.assign-checkbox').forEach(cb =>
    cb.addEventListener('change', async () => { if (cb.checked) await assignExercise(cb.dataset.exId); else await unassignExercise(cb.dataset.exId); }));
  document.querySelectorAll('.assign-field').forEach(inp =>
    inp.addEventListener('change', async (e) => { await updateAssignmentField(e.target.dataset.exId, e.target.dataset.field, e.target.value); }));
};

// Fetch a single client's assigned plan straight from Supabase so the
// client portal never depends on the bulk-loaded cache being keyed exactly
// the same way (e.g. client_id stored as uuid vs text). Falls back to the
// local cache when offline or on error.
window.fetchClientPlan = async function (clientId) {
  if (!APP_STATE.supabaseClient || !clientId) return [];
  try {
    const { data, error } = await APP_STATE.supabaseClient
      .from('client_exercises').select('*').eq('client_id', clientId);
    if (error) throw error;
    const list = data || [];
    // Keep the global cache in sync with what we just fetched.
    clientMapSet(APP_STATE.clientExercisesCache, clientId, list);
    return list;
  } catch (err) {
    console.warn('fetchClientPlan fallback to cache:', err);
    return clientMapGet(APP_STATE.clientExercisesCache, clientId) || [];
  }
};

// Re-render the logged-in client's "My Plan" card from fresh server data.
window.refreshClientPlanView = async function () {
  const lc = APP_STATE.loggedInClient;
  if (!lc) return;
  const assigned = await fetchClientPlan(lc.id);
  renderClientPlan(lc, assigned);
};

window.assignExercise = async function (exId) {
  try {
    const { error } = await APP_STATE.supabaseClient.from('client_exercises')
      .insert({ client_id: APP_STATE.selectedClientId, exercise_id: exId, sort_order: 0 });
    if (error && !error.message.includes('duplicate')) throw error;
    if (!clientMapGet(APP_STATE.clientExercisesCache, APP_STATE.selectedClientId)) clientMapSet(APP_STATE.clientExercisesCache, APP_STATE.selectedClientId, []);
    const assignedList = clientMapGet(APP_STATE.clientExercisesCache, APP_STATE.selectedClientId);
    if (!assignedList.find(a => sameId(a.exercise_id, exId)))
      assignedList.push({ client_id: APP_STATE.selectedClientId, exercise_id: exId, sort_order: 0 });
    renderAssignList();
    refreshClientPlanView(); // keep any open client portal in sync
  } catch (err) { showStatus($('assignStatus'), '❌ ' + err.message, 'error'); }
};

window.unassignExercise = async function (exId) {
  try {
    await APP_STATE.supabaseClient.from('client_exercises')
      .delete().eq('client_id', APP_STATE.selectedClientId).eq('exercise_id', exId);
    if (clientMapGet(APP_STATE.clientExercisesCache, APP_STATE.selectedClientId))
      clientMapSet(APP_STATE.clientExercisesCache, APP_STATE.selectedClientId,
        clientMapGet(APP_STATE.clientExercisesCache, APP_STATE.selectedClientId).filter(a => !sameId(a.exercise_id, exId)));
    renderAssignList();
    refreshClientPlanView();
  } catch (err) { console.error(err); }
};

window.updateAssignmentField = async function (exId, field, val) {
  try {
    await APP_STATE.supabaseClient.from('client_exercises')
      .update({ [field]: val || null })
      .eq('client_id', APP_STATE.selectedClientId).eq('exercise_id', exId);
    const a = (clientMapGet(APP_STATE.clientExercisesCache, APP_STATE.selectedClientId) || []).find(x => sameId(x.exercise_id, exId));
    if (a) a[field] = val || null;
    refreshClientPlanView();
  } catch (err) { console.error(err); }
};