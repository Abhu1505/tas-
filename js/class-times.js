// ============================================================
// ADMIN — "Class Times" bulk editor
// ------------------------------------------------------------
// One table (client name · date 📅 · time ⏰ · note) where the
// trainer sets every client's class time in one place. Rows are
// upserted into `daily_times` on 💾 Save All Times, and because
// the Sessions grid + the client portal's upcoming schedule both
// read from dailyTimesCache/getTimeForDate, saved times appear
// instantly on that day everywhere.
// ============================================================
(function () {
  'use strict';

  // Panel open/close — behaves like the other admin panels
  // (only one settings-panel visible at a time, inside the 📋 Clients workspace).
  window.openClassTimesPanel = function () {
    if (typeof window.showAdminPanel === 'function') {
      // Lazy fallback: class-times.js may not have been bound at boot —
      // bind its toolbar buttons the first time the panel is opened.
      if (!window.__ctBound && typeof window.bindClassTimesEvents === 'function') {
        window.__ctBound = true;
        try { bindClassTimesEvents(); } catch (e) {}
      }
      showAdminPanel('classTimesPanel', 'renderClassTimesTable');
      return;
    }
    const panel = $('classTimesPanel');
    if (!panel) return;
    const wasHidden = panel.classList.contains('hidden');
    $('settingsPanel').classList.add('hidden');
    $('libraryPanel').classList.add('hidden');
    $('approvalsPanel').classList.add('hidden');
    panel.classList.toggle('hidden', !wasHidden);
    if (!panel.classList.contains('hidden')) renderClassTimesTable();
  };

  window.closeClassTimesPanel = function () {
    $('classTimesPanel').classList.add('hidden');
  };

  /* ---------- row markup ---------- */
  function rowHtml(clientId, name, dateStr, time, note) {
    // BUG FIX: was pinned to APP_CONFIG.CURRENT_YEAR (a static value captured
    // at page load), which blocked picking dates near a year boundary — e.g.
    // scheduling into October from a late-September session or after Jan 1.
    // min/max now follow the real current date ±18 months.
    const now = new Date();
    const minY = now.getFullYear(), minM = now.getMonth();
    const maxD = new Date(now.getFullYear(), now.getMonth() + 18, now.getDate());
    const min = formatDateISO(minY, minM, 1);
    const max = formatDateISO(maxD.getFullYear(), maxD.getMonth(), getDaysInMonth(maxD.getFullYear(), maxD.getMonth()));
    return `<tr class="classtimes-row">
      <td data-label="Client name"><select class="ct-client" aria-label="Client">${
        APP_STATE.clients.map(c => `<option value="${escapeHtml(String(c.id))}" ${sameId(c.id, clientId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')
      }</select></td>
      <td data-label="Date 📅"><input type="date" class="ct-date" min="${min}" max="${max}" value="${dateStr || ''}" aria-label="Class date"></td>
      <td data-label="Time ⏰"><input type="time" class="ct-time" value="${time || ''}" aria-label="Class time"></td>
      <td data-label="Note (optional)"><input type="text" class="ct-note" value="${escapeHtml(note || '')}" placeholder="optional" aria-label="Note"></td>
      <td class="ct-td-actions"><button type="button" class="btn-danger-small btn-small ct-remove" aria-label="Remove row">✕ Remove</button></td>
    </tr>`;
  }

  window.renderClassTimesTable = function (rowsOverride) {
    const body = $('classTimesTableBody');
    if (!body) return;

    // ---- Auto-populate the client filter dropdown from the CURRENT list ----
    // Rebuilt on every render (sorted by name) so newly created clients show
    // up automatically; the previous selection is preserved when possible.
    const filt = $('ctFilterClient');
    if (filt) {
      const prev = filt.value;
      filt.innerHTML = '<option value="">All clients</option>' +
        [...APP_STATE.clients]
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .map(c => `<option value="${escapeHtml(String(c.id))}">${escapeHtml(c.name || 'Unnamed')}</option>`)
          .join('');
      if (prev && APP_STATE.clients.some(c => sameId(c.id, prev))) filt.value = prev;
    }

    let rows = [];
    if (rowsOverride) {
      rows = rowsOverride;
    } else {
      // ✅ AUTO-LIST EVERY CLIENT — one row per client, always.
      // Each row is prefilled with that client's next scheduled class
      // (today or later); if none exists, the date is left blank so the
      // trainer can pick one 📅. Closed clients are included too.
      const todayStr = formatDateISO(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
      [...APP_STATE.clients]
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .forEach(c => {
          const upcoming = (clientMapGet(APP_STATE.dailyTimesCache, c.id) || [])
            .filter(d => String(d.day_date) >= todayStr)
            .sort((a, b) => a.day_date.localeCompare(b.day_date))[0];
          rows.push({
            cid: c.id,
            date: upcoming ? upcoming.day_date : '',
            time: upcoming ? upcoming.class_time : '',
            note: upcoming ? (upcoming.note || '') : ''
          });
        });
      if (rows.length === 0) rows.push({ cid: '', date: '', time: '', note: '' });
    }

    // Optional single-client filter (dropdown above the table).
    const only = filt ? filt.value : '';
    if (only) rows = rows.filter(r => sameId(r.cid, only));

    body.innerHTML = rows.map(r => rowHtml(r.cid, null, r.date, r.time, r.note)).join('');
    body.querySelectorAll('.ct-remove').forEach(b =>
      b.addEventListener('click', () => b.closest('tr').remove()));

    // Live count chip above the table so the trainer sees it's auto-filled.
    const countEl = $('ctClientCount');
    if (countEl) countEl.textContent = `📋 ${APP_STATE.clients.length} client(s) listed automatically`;
  };

  window.addClassTimesRow = function () {
    const body = $('classTimesTableBody');
    if (!body) return;
    const tr = document.createElement('tr');
    tr.innerHTML = rowHtml(APP_STATE.selectedClientId || APP_STATE.clients[0]?.id || '', null, '', ($('ctDefaultTime') || {}).value || '', '');
    // Replace innerHTML of a temp to get a real <tr>:
    const tmp = document.createElement('tbody');
    tmp.innerHTML = tr.innerHTML;
    const row = tmp.firstElementChild;
    body.appendChild(row);
    row.querySelector('.ct-remove').addEventListener('click', () => row.remove());
    row.querySelector('.ct-date')?.focus();
  };

  // Quick-fill: apply the chosen time to every Mon–Sat of the selected month
  // for each visible row's client (rows are created, not yet saved).
  window.applyWeekdaysClassTimes = function () {
    const body = $('classTimesTableBody');
    if (!body) return;
    const time = ($('ctDefaultTime') || {}).value || '07:00';
    const now = new Date();
    const month = parseInt(($('ctMonthSelect') || {}).value ?? now.getMonth(), 10);
    const year = now.getFullYear();
    const days = getDaysInMonth(year, month);
    const existingRows = Array.from(body.querySelectorAll('tr'));
    const clientIds = existingRows.map(r => r.querySelector('.ct-client')?.value)
      .filter((v, i, a) => v && a.indexOf(v) === i);
    if (clientIds.length === 0) { showToast('⚠️ No clients in the table yet.', 'warning'); return; }

    let added = 0;
    clientIds.forEach(cid => {
      // Skip clients that already have rows this month (avoid duplicates).
      const hasMonth = existingRows.some(r =>
        r.querySelector('.ct-client')?.value === cid &&
        (r.querySelector('.ct-date')?.value || '').startsWith(`${year}-${String(month + 1).padStart(2, '0')}`));
      if (hasMonth) return;
      for (let d = 1; d <= days; d++) {
        const dow = new Date(year, month, d).getDay(); // 0=Sun
        if (dow === 0) continue;                       // Mon–Sat
        const dateStr = formatDateISO(year, month, d);
        const tmp = document.createElement('tbody');
        tmp.innerHTML = rowHtml(cid, null, dateStr, time, '');
        const row = tmp.firstElementChild;
        row.querySelector('.ct-remove').addEventListener('click', () => row.remove());
        body.appendChild(row);
        added++;
      }
    });
    showStatus($('classTimesStatus'), `🗓 Added ${added} weekday rows — review then press 💾 Save All Times.`, 'info');
  };

  /* ---------- save all ---------- */
  window.saveAllClassTimes = async function () {
    const sb = APP_STATE.supabaseClient;
    if (!sb) { showStatus($('classTimesStatus'), '⏳ Still connecting to the cloud…', 'warning'); return; }
    const rows = Array.from(document.querySelectorAll('#classTimesTableBody tr'));
    const parsed = [];
    let errors = 0;
    rows.forEach(r => {
      const cid = r.querySelector('.ct-client')?.value;
      const date = r.querySelector('.ct-date')?.value;
      const time = r.querySelector('.ct-time')?.value;
      const note = (r.querySelector('.ct-note')?.value || '').trim();
      if (!cid && !date && !time) return; // fully empty row — ignore
      if (!cid || !date || !time) { errors++; r.classList.add('ct-row-invalid'); return; }
      r.classList.remove('ct-row-invalid');
      parsed.push({ cid, date, time, note });
    });
    if (errors > 0) {
      showStatus($('classTimesStatus'), `⚠️ ${errors} row(s) missing client/date/time — fix the highlighted rows or remove them.`, 'error');
      return;
    }
    if (parsed.length === 0) {
      showStatus($('classTimesStatus'), 'ℹ️ Nothing to save — add some rows first.', 'info');
      return;
    }
    // Duplicate check (same client + same date twice).
    const seen = new Set();
    for (const p of parsed) {
      const k = p.cid + '|' + p.date;
      if (seen.has(k)) {
        showStatus($('classTimesStatus'), '⚠️ Duplicate rows found for the same client & date — keep one per day.', 'error');
        return;
      }
      seen.add(k);
    }

    $('saveAllTimesBtn').disabled = true;
    try {
      // Upsert in chunks (PostgREST handles many rows fine).
      const { error } = await sb.from('daily_times').upsert(
        parsed.map(p => ({ client_id: p.cid, day_date: p.date, class_time: p.time, note: p.note || null })),
        { onConflict: 'client_id,day_date' });
      if (error) throw error;

      // Optimistic local cache update so the sessions grid & client portals
      // reflect the new times immediately.
      parsed.forEach(p => {
        const arr = clientMapGet(APP_STATE.dailyTimesCache, p.cid) || [];
        const idx = arr.findIndex(d => d.day_date === p.date);
        const rec = { client_id: p.cid, day_date: p.date, class_time: p.time, note: p.note || null };
        if (idx >= 0) arr[idx] = rec; else arr.push(rec);
        clientMapSet(APP_STATE.dailyTimesCache, p.cid, arr);
      });

      showStatus($('classTimesStatus'), `✅ Saved ${parsed.length} class time(s). They now show on those days in the Sessions grid and every client's portal.`, 'success');
      // Re-render everything that displays class times.
      if (APP_STATE.selectedClientId) renderSessions();
      if (typeof renderClientUpcoming === 'function' && APP_STATE.loggedInClient) renderClientUpcoming(APP_STATE.loggedInClient);
      renderClassTimesTable(); // reload rows from fresh cache
    } catch (e) {
      showStatus($('classTimesStatus'), '❌ Save failed: ' + friendlySchemaErrorMessage(e), 'error');
    } finally {
      $('saveAllTimesBtn').disabled = false;
    }
  };

  /* ---------- bindings ---------- */
  window.bindClassTimesEvents = function () {
    const open = $('classTimesBtn');      if (open) open.addEventListener('click', openClassTimesPanel);
    const close = $('closeClassTimesBtn');if (close) close.addEventListener('click', closeClassTimesPanel);
    const save = $('saveAllTimesBtn');    if (save) save.addEventListener('click', saveAllClassTimes);
    const add = $('ctAddRowBtn');         if (add) add.addEventListener('click', addClassTimesRow);
    const wk = $('ctApplyWeekdaysBtn');   if (wk) wk.addEventListener('click', applyWeekdaysClassTimes);
    const filt = $('ctFilterClient');     if (filt) filt.addEventListener('change', () => renderClassTimesTable());
    const mon = $('ctMonthSelect');       if (mon) {
      mon.value = new Date().getMonth();
      mon.addEventListener('change', () => renderClassTimesTable());
    }
  };
})();
