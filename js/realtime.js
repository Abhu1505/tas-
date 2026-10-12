// ============================================================
// Live sync (Supabase Realtime)
// ------------------------------------------------------------
// Subscribes to postgres_changes on every table the app writes
// to. When any tab (admin or client) inserts/updates/deletes a
// row, all open tabs refresh their data automatically — so when
// a trainer marks a session finished or assigns exercises, the
// client dashboard updates without pressing 🔄 Refresh, and vice
// versa when a client logs exercises or sends an edit request.
//
// Uses the anon key + RLS policies already in place; if Realtime
// is unavailable the app simply keeps working with the manual
// 🔄 Refresh button (graceful degradation).
// ============================================================
(function () {
  let _channel = null;
  let _bound = false;
  let _lastRemoteReloadAt = 0;

  // True when the current browser tab just performed a local write —
  // our own optimistic cache updates already handled it, so we ignore
  // the echo of our own change coming back through Realtime.
  window._liveSyncLocalWrite = false;
  function markLocalWrite() {
    window._liveSyncLocalWrite = true;
    setTimeout(() => { window._liveSyncLocalWrite = false; }, 4000);
  }
  ['toggleSession', 'saveWorkoutLogField', 'removeWorkoutLogById', 'addExerciseToDay',
   'assignExercise', 'unassignExercise', 'updateAssignmentField',
   'adminToggleDayUnlock', 'decideWorkoutEditRequest'].forEach(fnName => {
    const orig = window[fnName];
    if (typeof orig !== 'function') return;
    window[fnName] = function () {
      markLocalWrite();
      return orig.apply(this, arguments);
    };
  });

  // Debounced reload so a burst of changes (e.g. bulk operations) only
  // triggers one re-fetch.
  let _timer = null;
  function scheduleLiveReload() {
    if (window._liveSyncLocalWrite) return; // our own write — nothing to do
    clearTimeout(_timer);
    _timer = setTimeout(async () => {
      if (window._liveSyncLocalWrite) return;
      // Instant alert check (beep + popup + badge) when a remote change
      // arrives via Realtime — no need to wait for the next 60s poll.
      try { if (typeof window.notifyFromRealtime === 'function') window.notifyFromRealtime(); } catch (e) {}
      try {
        _lastRemoteReloadAt = Date.now();
        await loadAllData(); // also re-renders roster + client portal views
        // Re-render whichever portal is currently open so both dashboards
        // "update anything" instantly: sessions grid, assign list, approvals,
        // progress panels, client plan/history/schedule — everything.
        if (typeof renderSessions === 'function') renderSessions();
        if (typeof renderAssignList === 'function') renderAssignList();
        if (typeof renderApprovals === 'function') renderApprovals();
        if (typeof updateApprovalsBadge === 'function') updateApprovalsBadge();
        if (typeof renderAdminProgress === 'function') renderAdminProgress();
        showToast('📡 Updated live from your trainer/client.', 'info', 2200);
      } catch (err) { console.warn('live reload failed:', err); }
    }, 800);
  }

  window.initRealtimeSync = function () {
    const sb = APP_STATE.supabaseClient;
    if (!sb || _bound) return;
    _bound = true;
    try {
      _channel = sb.channel('app-live-sync')
        .on('postgres_changes', { schema: 'public', event: '*', table: 'sessions' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'workout_logs' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'daily_times' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'client_exercises' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'exercises' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'workout_edit_requests' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'profile_approvals' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'progress_approvals' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'progress_entries' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'client_settings' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'client_profiles' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'clients' }, p => scheduleLiveReload(p))
        .on('postgres_changes', { schema: 'public', event: '*', table: 'client_requests' }, p => scheduleLiveReload(p))
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') console.info('📡 Live sync active.');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // Realtime unavailable — keep manual Refresh as the fallback.
            console.warn('Live sync unavailable (' + status + ') — use 🔄 Refresh.');
            _bound = false;
          }
        });
    } catch (e) {
      console.warn('initRealtimeSync failed:', e);
      _bound = false;
    }
  };
})();
