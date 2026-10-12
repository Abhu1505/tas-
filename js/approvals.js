window.renderApprovals = function () {
  const container = $('approvalsList'); if (!container) return;
  const source = APP_STATE.currentApprovalType === 'profile'
    ? APP_STATE.profileApprovals
    : APP_STATE.currentApprovalType === 'workout'
      ? (APP_STATE.workoutEditRequests || []).filter(r => r.status === 'pending')
      : APP_STATE.progressApprovals;
  let list = APP_STATE.currentApprovalTab === 'pending'
    ? source.filter(a => a.status === 'pending')
    : source.filter(a => a.status !== 'pending');
  // BUG FIX: the old line `if (type === 'workout') list = source;` overrode
  // the tab filter, so decided/stale workout-edit rows reappeared in the
  // History tab (and after wipes). source is already pending-filtered above.
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-message">No ${APP_STATE.currentApprovalTab} ${APP_STATE.currentApprovalType === 'workout' ? 'workout edit' : APP_STATE.currentApprovalType} approvals.</div>`;
    return;
  }
  let html = '';
  if (APP_STATE.currentApprovalType === 'workout') {
    list.forEach(r => {
      const c = getClient(r.client_id);
      const clientName = c ? c.name : 'Unknown';
      const submitted = r.requested_at ? new Date(r.requested_at).toLocaleString() : '—';
      const pd = r.proposed_data || {};
      const action = r.proposed_action || 'unlock';
      const icon = action === 'add' ? '➕' : action === 'delete' ? '🗑' : action === 'edit' ? '✏️' : '🔓';
      const title = action === 'add'
        ? `Add exercise “${escapeHtml(pd.exercise_name || '?')}”`
        : action === 'delete'
          ? 'Remove an exercise'
          : action === 'edit'
            ? `Change ${Object.keys(pd).map(k => `<strong>${escapeHtml(k)}</strong> → <em>${escapeHtml(String(pd[k] ?? '—'))}</em>`).join(', ')}`
            : 'Unlock day for editing';
      html += `<div class="approval-card">
        <div class="approval-card-header"><div style="min-width:0;">
          <div class="approval-card-title">${icon} Workout Edit — ${escapeHtml(clientName)}</div>
          <div class="approval-card-date">Day: <strong>${escapeHtml(r.session_date)}</strong> · Requested: ${submitted}</div>
          <div style="font-size:0.8rem;margin-top:0.3rem;padding:0.4rem 0.6rem;background:var(--bg-alt,#f6f8fa);border-radius:8px;">${title}${r.entry_log_id ? ` <span style="color:#7893a8;font-size:0.7rem;">(entry ${escapeHtml(String(r.entry_log_id)).slice(0, 8)}…)</span>` : ''}</div>
        </div></div>
        <div class="approval-actions">
          <button class="btn-approve" data-wer-id="${r.id || ''}" data-wer-client="${r.client_id}" data-wer-date="${escapeHtml(r.session_date)}">✅ Approve &amp; apply</button>
          <button class="btn-reject" data-wer-id="${r.id || ''}" data-wer-client="${r.client_id}" data-wer-date="${escapeHtml(r.session_date)}">❌ Deny</button>
        </div>
      </div>`;
    });
    container.innerHTML = html;
    container.querySelectorAll('.btn-approve[data-wer-id]').forEach(b =>
      b.addEventListener('click', () => decideWorkoutEditRequest(b.dataset.werId, b.dataset.werClient, b.dataset.werDate, 'approved')));
    container.querySelectorAll('.btn-reject[data-wer-id]').forEach(b =>
      b.addEventListener('click', () => decideWorkoutEditRequest(b.dataset.werId, b.dataset.werClient, b.dataset.werDate, 'rejected')));
    return;
  }
  list.forEach(a => {
    const c = getClient(a.client_id);
    const clientName = c ? c.name : 'Unknown';
    const submitted = new Date(a.submitted_at).toLocaleString();
    const decided = a.decided_at ? new Date(a.decided_at).toLocaleString() : '';
    const statusClass = a.status === 'pending' ? '' : (a.status === 'approved' ? 'completed' : 'rejected');
    const statusColor = a.status === 'pending' ? '' : (a.status === 'approved' ? 'completed' : 'rejected');

    if (APP_STATE.currentApprovalType === 'profile') {
      const proposed = a.proposed_data || {};
      const current = a.current_data || {};
      const fields = ['height_cm','gender','birth_date','goal','medical_notes','emergency_contact'];
      let diffRows = '';
      fields.forEach(f => {
        const oldV = current[f] ?? '';
        const newV = proposed[f] ?? '';
        if (String(oldV) !== String(newV))
          diffRows += `<tr><td class="field">${f.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</td><td class="old">${escapeHtml(String(oldV || '—'))}</td><td class="arrow">→</td><td class="new">${escapeHtml(String(newV || '—'))}</td></tr>`;
      });
      html += `<div class="approval-card ${statusClass}">
        <div class="approval-card-header"><div style="min-width:0;"><div class="approval-card-title ${statusColor}">${a.status === 'pending' ? '⏳ Pending Profile' : (a.status === 'approved' ? '✅ Approved Profile' : '❌ Rejected Profile')} — ${escapeHtml(clientName)}</div><div class="approval-card-date">Submitted: ${submitted}${decided ? ' · Decided: ' + decided : ''}</div></div>${a.admin_note ? `<span style="font-size:0.68rem;background:#f3e5f5;color:#6a1b9a;padding:0.2rem 0.5rem;border-radius:20px;font-weight:700;">💬 ${escapeHtml(a.admin_note)}</span>` : ''}</div>
        ${diffRows ? `<table class="approval-diff-table"><thead><tr><th>Field</th><th>Old</th><th></th><th>New</th></tr></thead><tbody>${diffRows}</tbody></table>` : '<div style="font-size:0.78rem;color:#7893a8;font-style:italic;">No visible differences.</div>'}
        ${a.status === 'pending' ? `<div class="approval-actions"><input type="text" class="approval-note-input" id="approvalNote-${a.id}" placeholder="Optional note"><button class="btn-approve" data-id="${a.id}" data-type="profile">✅ Approve</button><button class="btn-reject" data-id="${a.id}" data-type="profile">❌ Reject</button></div>` : ''}
      </div>`;
    } else {
      const actionLabel = a.action === 'add' ? '➕ Add' : (a.action === 'edit' ? '✏️ Edit' : '🗑️ Delete');
      const proposed = a.proposed_data || {};
      const current = a.current_data || {};
      let diffRows = '';
      if (a.action === 'delete') {
        diffRows = `<tr><td class="field">Action</td><td class="old">—</td><td class="arrow">→</td><td class="new">Delete entry from ${escapeHtml(current?.entry_date || '—')}</td></tr>`;
      } else {
        const fields = ['entry_date','weight_kg','body_fat_pct','chest_cm','waist_cm','hips_cm','arms_cm','thighs_cm','notes'];
        fields.forEach(f => {
          const oldV = current ? (current[f] ?? '') : '';
          const newV = proposed[f] ?? '';
          if (String(oldV) !== String(newV))
            diffRows += `<tr><td class="field">${f.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</td><td class="old">${escapeHtml(String(oldV || '—'))}</td><td class="arrow">→</td><td class="new">${escapeHtml(String(newV || '—'))}</td></tr>`;
        });
      }
      html += `<div class="approval-card ${statusClass}">
        <div class="approval-card-header"><div style="min-width:0;"><div class="approval-card-title ${statusColor}">${a.status === 'pending' ? '⏳ Pending Progress' : (a.status === 'approved' ? '✅ Approved Progress' : '❌ Rejected Progress')} — ${escapeHtml(clientName)} <span style="font-size:0.7rem;background:#e3f2fd;color:#0d47a1;padding:0.15rem 0.5rem;border-radius:20px;font-weight:700;">${actionLabel}</span></div><div class="approval-card-date">Submitted: ${submitted}${decided ? ' · Decided: ' + decided : ''}</div></div>${a.admin_note ? `<span style="font-size:0.68rem;background:#f3e5f5;color:#6a1b9a;padding:0.2rem 0.5rem;border-radius:20px;font-weight:700;">💬 ${escapeHtml(a.admin_note)}</span>` : ''}</div>
        ${diffRows ? `<table class="approval-diff-table"><thead><tr><th>Field</th><th>Old</th><th></th><th>New</th></tr></thead><tbody>${diffRows}</tbody></table>` : '<div style="font-size:0.78rem;color:#7893a8;font-style:italic;">No visible differences.</div>'}
        ${a.status === 'pending' ? `<div class="approval-actions"><input type="text" class="approval-note-input" id="approvalNote-${a.id}" placeholder="Optional note"><button class="btn-approve" data-id="${a.id}" data-type="progress">✅ Approve</button><button class="btn-reject" data-id="${a.id}" data-type="progress">❌ Reject</button></div>` : ''}
      </div>`;
    }
  });
  container.innerHTML = html;
  container.querySelectorAll('.btn-approve').forEach(b =>
    b.addEventListener('click', () => decideApproval(b.dataset.id, 'approved', b.dataset.type)));
  container.querySelectorAll('.btn-reject').forEach(b =>
    b.addEventListener('click', () => decideApproval(b.dataset.id, 'rejected', b.dataset.type)));
};

window.decideApproval = async function (id, decision, type) {
  const source = type === 'progress' ? APP_STATE.progressApprovals : APP_STATE.profileApprovals;
  const a = source.find(x => String(x.id) === String(id));
  if (!a) return;
  const noteEl = $(`approvalNote-${id}`);
  const note = noteEl ? noteEl.value.trim() : '';
  const okDecision = await uiConfirm({
    title: `${decision === 'approved' ? 'Approve' : 'Reject'} ${type === 'progress' ? 'Progress' : 'Profile'} Change`,
    message: `Are you sure you want to ${decision === 'approved' ? 'approve' : 'reject'} this ${type} change?`,
    confirmText: decision === 'approved' ? '✅ Approve' : '❌ Reject',
    danger: decision !== 'approved'
  });
  if (!okDecision) return;
  // 'decided_at' and 'admin_note' columns are added by sql/fix_approvals.sql.
  // If that migration has NOT been run yet, fall back to a minimal update so
  // approve/reject never fails with "Could not find the ... column".
  function isMissingColError(err) {
    const m = (err && err.message) || '';
    return /could not find.*column|schema cache/i.test(m) && /decided_at|admin_note/i.test(m);
  }
  // Generic "column/table doesn't exist in the schema cache" detector — used
  // for optional migrations (e.g. sql/fitness_calculator.sql fit_* profile
  // columns and the fitness_inputs table). Approvals must never hard-fail
  // just because a newer migration hasn't been run yet.
  window.isSchemaMissingError = function (err) {
    const m = (err && err.message) || '';
    return /could not find .*column|schema cache|relation .* does not exist|not found in the schema cache/i.test(m);
  };
  try {
    let updates;
    if (APP_STATE.__approvalsExtraColsOk === false) {
      updates = { status: decision };
    } else {
      updates = { status: decision, decided_at: new Date().toISOString(), admin_note: note || null };
    }
    const table = type === 'progress' ? 'progress_approvals' : 'profile_approvals';
    let res = await APP_STATE.supabaseClient.from(table).update(updates).eq('id', id);
    if (res.error && isMissingColError(res.error)) {
      // Migration not applied yet — retry with only the columns we know exist.
      APP_STATE.__approvalsExtraColsOk = false;
      updates = { status: decision };
      res = await APP_STATE.supabaseClient.from(table).update(updates).eq('id', id);
    } else if (!res.error) {
      APP_STATE.__approvalsExtraColsOk = true;
    }
    if (res.error) throw res.error;
    if (type === 'progress') {
      // 📌 Approval gate flag: a client-side decision here must clear the
      // local "pending" marker so the calculator live-preview gate reopens.
      try { localStorage.removeItem('tas_profile_pending:' + String(a.client_id)); } catch (e) { }
      if (decision === 'approved') {
        const proposed = a.proposed_data || {};
        if (a.action === 'add') {
          const payload = { client_id: a.client_id, added_by: 'client', ...proposed };
          delete payload.id;           // let the DB generate the new entry id
          delete payload.created_at;   // use the DB default
          const { data, error: e2 } = await APP_STATE.supabaseClient.from('progress_entries').insert(payload).select().single();
          if (e2) throw e2;
          if (!APP_STATE.progressEntries[a.client_id]) APP_STATE.progressEntries[a.client_id] = [];
          APP_STATE.progressEntries[a.client_id].unshift(data);
        } else if (a.action === 'edit' && a.entry_id) {
          const { error: e2 } = await APP_STATE.supabaseClient.from('progress_entries').update({ ...proposed }).eq('id', a.entry_id);
          if (e2) throw e2;
          const arr = APP_STATE.progressEntries[a.client_id] || [];
          const idx = arr.findIndex(x => String(x.id) === String(a.entry_id));
          if (idx >= 0) arr[idx] = { ...arr[idx], ...proposed };
        } else if (a.action === 'delete' && a.entry_id) {
          const { error: e2 } = await APP_STATE.supabaseClient.from('progress_entries').delete().eq('id', a.entry_id);
          if (e2) throw e2;
          APP_STATE.progressEntries[a.client_id] = (APP_STATE.progressEntries[a.client_id] || [])
            .filter(x => String(x.id) !== String(a.entry_id));
        }
      }
      Object.assign(a, updates);
      renderApprovals(); updateApprovalsBadge(); renderClientList();
      if (sameId(APP_STATE.selectedClientId, a.client_id)) renderAdminProgress();
      // If that client happens to be signed in on THIS device, refresh their
      // portal too — 📈 Progress insights (charts + approved calculator KPIs)
      // must reflect the approval immediately.
      if (APP_STATE.loggedInClient && sameId(APP_STATE.loggedInClient.id, a.client_id)) {
        renderClientProgress(APP_STATE.loggedInClient);
        try { if (typeof window.renderClientInsights === 'function') window.renderClientInsights(APP_STATE.loggedInClient.id); } catch (e) { }
      }
    } else {
      if (decision === 'approved') {
        // 🗂️ SNAPSHOT-ON-RE-APPROVAL: when a client re-submits their profile
        // (the weekly "🔄 Update my profile" flow) and the trainer approves
        // AGAIN, the PREVIOUS approved data — every detail: basic fields +
        // shared calculator inputs + the last update date — is archived into
        // progress_entries first, so 📈 Progress builds up a history of each
        // approved snapshot. Skipped for a client's very FIRST approval
        // (there is no previous data to archive). Best-effort: any failure
        // here never blocks the approval itself.
        try {
          const prevP = clientMapGet(APP_STATE.clientProfiles, a.client_id) || {};
          const hasPrevData = window.profileHasApprovedData
            ? window.profileHasApprovedData(prevP)
            : (window.profileHasCalcStats ? window.profileHasCalcStats(prevP) : false);
          if (hasPrevData && !a.proposed_data._snapshot) {
            const snapDate = String((prevP.approved_at || prevP.updated_at
              || (APP_STATE.profileApprovals.find(x => sameId(x.client_id, a.client_id) && x.status === 'approved') || {}).decided_at
              || '')).slice(0, 10) || new Date().toISOString().slice(0, 10);
            const stats = (typeof window.profileCalcStats === 'function') ? window.profileCalcStats(prevP) : {};
            const snapNotes = [
              '📋 Profile snapshot (archived automatically when the next profile update was approved)',
              'Last updated: ' + snapDate,
              'Height: ' + (prevP.height_cm ?? stats.height ?? '—') + ' cm',
              'Gender: ' + (prevP.gender ?? stats.gender ?? '—'),
              'Goal: ' + (prevP.goal ?? stats.goal ?? '—'),
              'Age: ' + (stats.age ?? '—'),
              'Weight: ' + (stats.weight ?? '—') + ' kg',
              'Activity: ' + (stats.activity ?? '—'),
              'Waist: ' + (stats.waist ?? '—') + ' cm · Neck: ' + (stats.neck ?? '—') + ' cm · Hip: ' + (stats.hip ?? '—') + ' cm',
              'Bench: ' + (stats.bench ?? '—') + ' kg · Body fat: ' + (stats.bodyfat ?? '—') + ' %',
              prevP.medical_notes ? ('Medical notes: ' + prevP.medical_notes) : '',
              prevP.emergency_contact ? ('Emergency contact: ' + prevP.emergency_contact) : ''
            ].filter(Boolean).join('\n');
            const { data: snapRow, error: snapErr } = await APP_STATE.supabaseClient
              .from('progress_entries')
              .insert({
                client_id: a.client_id,
                entry_date: snapDate,
                weight_kg: Number.isFinite(parseFloat(stats.weight)) ? parseFloat(stats.weight) : null,
                body_fat_pct: Number.isFinite(parseFloat(stats.bodyfat)) ? parseFloat(stats.bodyfat) : null,
                waist_cm: Number.isFinite(parseFloat(stats.waist)) ? parseFloat(stats.waist) : null,
                notes: '[PROFILE-SNAPSHOT] ' + snapNotes,
                added_by: 'profile-snapshot'
              })
              .select().single();
            if (!snapErr && snapRow) {
              const arr = clientMapGet(APP_STATE.progressEntries, a.client_id) || [];
              arr.unshift(snapRow);
              clientMapSet(APP_STATE.progressEntries, a.client_id, arr);
            } else if (snapErr) {
              console.warn('Profile snapshot archival skipped:', snapErr.message);
            }
          }
        } catch (snapErr) { console.warn('Profile snapshot archival skipped:', snapErr); }

        const payload = {
          client_id: a.client_id,
          height_cm: a.proposed_data.height_cm ?? null,
          gender: a.proposed_data.gender ?? null,
          birth_date: a.proposed_data.birth_date ?? null,
          goal: a.proposed_data.goal ?? null,
          medical_notes: a.proposed_data.medical_notes ?? null,
          emergency_contact: a.proposed_data.emergency_contact ?? null,
          updated_at: new Date().toISOString(),
        };
        // 🧮 Calculator Body Stats — fit_* columns added by
        // sql/fitness_calculator.sql. Only sent when the proposal contains
        // them; stripped again below if the migration isn't applied yet.
        const hasFitStats = Object.keys(a.proposed_data).some(k => k.startsWith('fit_'));
        if (hasFitStats) {
          ['fit_weight_kg', 'fit_height_cm', 'fit_age', 'fit_gender', 'fit_activity_level',
           'fit_goal', 'fit_waist_cm', 'fit_neck_cm', 'fit_hip_cm', 'fit_bench_kg',
           'fit_body_fat_pct'].forEach(k => { payload[k] = a.proposed_data[k] ?? null; });
        }
        // approved_at / approved_by come from sql/fix_approvals.sql; only send
        // them when the migration is known to be applied, so approval of the
        // profile itself never fails on a missing column.
        if (APP_STATE.__approvalsExtraColsOk !== false) {
          payload.approved_at = new Date().toISOString();
          payload.approved_by = APP_STATE.adminConfig.admin_login_id;
        }
        let res2 = await APP_STATE.supabaseClient.from('client_profiles')
          .upsert(payload, { onConflict: 'client_id' });
        if (res2.error && isMissingColError(res2.error)) {
          delete payload.approved_at;
          delete payload.approved_by;
          res2 = await APP_STATE.supabaseClient.from('client_profiles')
            .upsert(payload, { onConflict: 'client_id' });
        }
        if (res2.error && hasFitStats && typeof window.isSchemaMissingError === 'function'
            && window.isSchemaMissingError(res2.error)) {
          // sql/fitness_calculator.sql not run → drop the fit_* columns and
          // approve the rest of the profile normally.
          Object.keys(payload).forEach(k => { if (k.startsWith('fit_')) delete payload[k]; });
          res2 = await APP_STATE.supabaseClient.from('client_profiles')
            .upsert(payload, { onConflict: 'client_id' });
        }
        if (res2.error) throw res2.error;
        APP_STATE.clientProfiles[a.client_id] = { ...(APP_STATE.clientProfiles[a.client_id] || {}), ...payload };
        // 📌 Approval gate OFF: the profile decision (approve OR reject) clears
        // the local pending marker, so the client's calculator live-preview is
        // unblocked again and the Profile tab chip flips to ✅/✍️ on next render.
        try { localStorage.removeItem('tas_profile_pending:' + String(a.client_id)); } catch (e) { }
        // Push the approved stats straight into the calculator hub's saved
        // inputs so the Calculators tab reflects them instantly (best-effort:
        // silently skipped if the fitness_inputs table doesn't exist yet).
        if (hasFitStats && typeof window.syncFitnessInputsFromProfile === 'function') {
          try { await window.syncFitnessInputsFromProfile(a.client_id); } catch (e) { console.warn('fitness sync skipped', e); }
        }
      }
      Object.assign(a, updates);
      renderApprovals(); updateApprovalsBadge(); renderClientList();
      // 📈 Approved profile → the client's Progress insights (calculator KPIs)
      // refresh instantly when that client is signed in on this device.
      if (decision === 'approved' && APP_STATE.loggedInClient && sameId(APP_STATE.loggedInClient.id, a.client_id)) {
        try { if (typeof window.renderClientInsights === 'function') window.renderClientInsights(a.client_id); } catch (e) { }
      }
    }
    showStatus($('approvalsStatus'), `✅ ${decision === 'approved' ? 'Approved' : 'Rejected'}.`, 'success');
    setTimeout(() => clearStatus($('approvalsStatus')), 3000);
  } catch (err) {
    showStatus($('approvalsStatus'), `❌ ${err.message}`, 'error');
  }
};

// Approve/deny a client's staged workout-log edit. On APPROVE the proposal is
// actually applied to `workout_logs` here (edit / add / delete) — until then
// the official log never shows the client's change. Plain "unlock" requests
// (no proposed_action) just toggle day editability like before.
window.decideWorkoutEditRequest = async function (id, clientId, dateStr, decision) {
  const req = (APP_STATE.workoutEditRequests || []).find(r =>
    String(r.client_id) === String(clientId) && r.session_date === dateStr && r.status === 'pending');
  const action = req ? (req.proposed_action || 'unlock') : 'unlock';
  const ok = await uiConfirm({
    title: decision === 'approved' ? 'Approve Edit' : 'Deny Edit',
    message: decision === 'approved'
      ? (action === 'unlock'
        ? `Unlock the workout log for ${dateStr} so the client can edit it?`
        : `Apply the client's proposed change (${action}) to the official log for ${dateStr}?`)
      : `Deny the edit request for ${dateStr}?`,
    confirmText: decision === 'approved' ? '✅ Approve' : '❌ Deny',
    danger: decision !== 'approved'
  });
  if (!ok) return;
  if (!req) { renderApprovals(); return; }
  try {
    const sb = APP_STATE.supabaseClient;
    if (decision === 'approved' && action !== 'unlock') {
      // ---- Apply the staged proposal to the official log ----
      const pd = req.proposed_data || {};
      const k = `${clientId}-${dateStr}`;
      const arr = APP_STATE.workoutLogsCache[k] || (APP_STATE.workoutLogsCache[k] = []);
      if (action === 'edit' && req.entry_log_id) {
        const { error } = await sb.from('workout_logs').update(pd).eq('id', req.entry_log_id);
        if (error) throw error;
        const idx = arr.findIndex(w => String(w.id) === String(req.entry_log_id));
        if (idx >= 0) arr[idx] = { ...arr[idx], ...pd };
      } else if (action === 'add') {
        const { data, error } = await sb.from('workout_logs')
          .insert({ client_id: clientId, session_date: dateStr, exercise_name: pd.exercise_name || 'New exercise',
                    sets_done: pd.sets_done ?? null, reps_done: pd.reps_done ?? null,
                    weight_done: pd.weight_done ?? null, rest_done: pd.rest_done ?? null, notes: pd.notes ?? null })
          .select().single();
        if (error) throw error;
        if (data) arr.push(data);
      } else if (action === 'delete' && req.entry_log_id) {
        const { error } = await sb.from('workout_logs').delete().eq('id', req.entry_log_id);
        if (error) throw error;
        APP_STATE.workoutLogsCache[k] = arr.filter(w => String(w.id) !== String(req.entry_log_id));
      }
    }
    if (decision === 'approved' && action === 'unlock') req.admin_unlocked = true;
    if (id) {
      const upd = { status: decision, decided_at: new Date().toISOString() };
      let { error } = await sb.from('workout_edit_requests').update(upd).eq('id', id);
      if (error && /could not find .*column|schema cache/i.test(String(error.message || ''))) {
        ({ error } = await sb.from('workout_edit_requests').update({ status: decision }).eq('id', id));
      }
      if (error) throw error;
    }
    req.status = decision;
    renderApprovals(); updateApprovalsBadge();
    if (typeof loadAllData === 'function') loadAllData().catch(() => {});
    showStatus($('approvalsStatus'), decision === 'approved'
      ? (action === 'unlock' ? '🔓 Day unlocked.' : '✅ Change applied to the official log.')
      : '❌ Request denied.', 'success');
    setTimeout(() => clearStatus($('approvalsStatus')), 3000);
  } catch (err) {
    if (window.isMissingTableError(err)) {
      await window.handleMissingWerTable();
      return;
    }
    showStatus($('approvalsStatus'), '❌ ' + err.message, 'error');
  }
};


window.updateApprovalsBadge = function () {
  // SHARED true-pending filter — stale/legacy rows (already decided, ghost
  // clients, or ancient leftovers) never light up this badge.
  const pending = window.getTruePendingCounts ? window.getTruePendingCounts().total
    : (APP_STATE.profileApprovals.filter(a => a.status === 'pending').length
      + APP_STATE.progressApprovals.filter(a => a.status === 'pending').length
      + (APP_STATE.workoutEditRequests || []).filter(r => r.status === 'pending').length);
  const badge = $('approvalsCountBadge'); if (!badge) return;
  if (pending > 0) { badge.textContent = pending; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
};

// Toggle the client-portal "⏳ Pending approval" banner from the TRUE
// pending counts for the logged-in client (never from raw legacy rows).
window.syncClientPendingBanner = function () {
  const el = $('clientPendingBanner');
  if (!el) return;
  const c = APP_STATE.loggedInClient;
  if (!c) { el.classList.add('hidden'); return; }
  let show = false;
  try {
    show = window.getClientPendingRows
      ? window.getClientPendingRows(c.id).total > 0
      : (APP_STATE.profileApprovals.some(a => sameId(a.client_id, c.id) && a.status === 'pending')
        || APP_STATE.progressApprovals.some(a => sameId(a.client_id, c.id) && a.status === 'pending'));
  } catch (e) { show = false; }
  el.classList.toggle('hidden', !show);
};