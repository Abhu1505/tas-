window.openWipeModal = function () {
  $('clearAllModal').classList.remove('hidden');
  $('clearConfirmInput').value = '';
  $('confirmClearAllBtn').disabled = true;
  $('wipeArchiveEmailDisplay').textContent = APP_STATE.adminConfig.archive_email || '(not set)';
  clearStatus($('clearAllStatus'));
};

window.performWipe = async function () {
  const btn = $('confirmClearAllBtn');
  btn.disabled = true;
  btn.textContent = '📧 Preparing...';

  let report = '';
  try { report = buildFullDataReport(); }
  catch (e) { report = 'Error building report: ' + e.message; }

  const archiveEmail = APP_STATE.adminConfig.archive_email || '';
  const subject = `Training Data Backup — ${new Date().toLocaleDateString()}`;
  const MAX = 1800;
  const bodyTruncated = report.length > MAX
    ? report.slice(0, MAX) + `\n\n…[TRUNCATED — total report length: ${report.length} chars]\n(Full data was in the app; wipe proceeding.)`
    : report;
  const mailto = `mailto:${encodeURIComponent(archiveEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyTruncated)}`;

  showStatus($('clearAllStatus'), '📧 Opening mail client with report… You have 3 seconds to click Send. Then data will be wiped.', 'info');

  try { window.location.href = mailto; } catch (e) { console.warn(e); }

  setTimeout(async () => {
    btn.textContent = '⏳ Wiping...';
    try {
      const sb = APP_STATE.supabaseClient;
      // "delete everything" — uses gt on the primary key so it works for both
      // bigint ids (gt 0) and uuid ids (gt '0000...'), regardless of column type.
      const wipeAll = async (table, col = 'id') => {
        try { await sb.from(table).delete().gt(col, 0); }
        catch (e) {
          try { await sb.from(table).delete().gt(col, '00000000-0000-0000-0000-000000000000'); }
          catch (e2) { console.warn(`wipe: table ${table} skipped`, e2); }
        }
      };
      await wipeAll('progress_approvals');
      await wipeAll('profile_approvals');
      await wipeAll('daily_times');
      await wipeAll('progress_entries');
      await wipeAll('workout_logs');
      await wipeAll('client_exercises');
      await wipeAll('sessions');
      // BUG FIX: these three tables were missing from the wipe sequence, so
      // stale client_requests / workout_edit_requests / progress_reports rows
      // survived a "clear all" and reappeared as ghost entries (🚫 pending
      // chips, phantom future days like "9 October") in every client portal.
      await wipeAll('client_requests');
      await wipeAll('workout_edit_requests');
      await wipeAll('progress_reports');
      // 🧮 Calculator hub saved inputs (sql/fitness_calculator.sql).
      try { await wipeAll('fitness_inputs', 'client_id'); } catch (e) { console.warn('wipe: fitness_inputs skipped', e); }
      await wipeAll('client_profiles', 'client_id');
      await wipeAll('client_settings', 'client_id');
      // BUG FIX: delete clients FIRST, then re-run the child-table wipes.
      // With Supabase realtime enabled, any client row that still existed when
      // the child tables were cleared could instantly re-insert its data from
      // another logged-in device ("data comes back after wipe"). Removing the
      // parent rows first closes that window.
      await wipeAll('clients');
      await wipeAll('progress_approvals');
      await wipeAll('profile_approvals');
      await wipeAll('daily_times');
      await wipeAll('progress_entries');
      await wipeAll('workout_logs');
      await wipeAll('client_exercises');
      await wipeAll('sessions');
      await wipeAll('client_requests');
      await wipeAll('workout_edit_requests');
      await wipeAll('progress_reports');
      // 🧮 Calculator hub saved inputs (sql/fitness_calculator.sql).
      try { await wipeAll('fitness_inputs', 'client_id'); } catch (e) { console.warn('wipe: fitness_inputs skipped', e); }
      await wipeAll('client_profiles', 'client_id');
      await wipeAll('client_settings', 'client_id');
      await wipeAll('exercises');

      // HARDCODED ADMIN CREDENTIALS — never removed by a wipe. The
      // admin_config row is always reset to the values in js/config.js
      // (unless WIPE_ADMIN_CONFIG_ROW is explicitly set to true).
      if (APP_CONFIG.WIPE_ADMIN_CONFIG_ROW) {
        try { await sb.from('admin_config').delete().eq('id', 1); } catch (e) { console.warn(e); }
      } else {
        await sb.from('admin_config').upsert({
          id: 1,
          admin_login_id: APP_CONFIG.DEFAULT_ADMIN_ID,
          admin_password: APP_CONFIG.DEFAULT_ADMIN_PW,
          archive_email: APP_STATE.adminConfig.archive_email || 'trainer@example.com',
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' }).then(r => r.error).catch(() =>
          sb.from('admin_config').update({
            admin_login_id: APP_CONFIG.DEFAULT_ADMIN_ID,
            admin_password: APP_CONFIG.DEFAULT_ADMIN_PW,
            archive_email: APP_STATE.adminConfig.archive_email || 'trainer@example.com',
            updated_at: new Date().toISOString()
          }).eq('id', 1)
        );
      }

      APP_STATE.clients = [];
      APP_STATE.clientSettings = {};
      APP_STATE.clientProfiles = {};
      APP_STATE.progressEntries = {};
      APP_STATE.progressApprovals = [];
      APP_STATE.sessionCache = {};
      APP_STATE.exercises = [];
      APP_STATE.clientExercisesCache = {};
      APP_STATE.workoutLogsCache = {};
      APP_STATE.dailyTimesCache = {};
      APP_STATE.profileApprovals = [];
      APP_STATE.clientRequests = [];
      APP_STATE.workoutEditRequests = [];
      APP_STATE.savedReports = [];
      try { localStorage.removeItem('pt_progress_reports_v1'); } catch (e) {}
      // 🧮 Calculator hub: clear every local cached copy AND re-issue the
      // cloud delete, so saved calculator inputs never "come back" after a wipe.
      if (typeof window.wipeFitnessInputs === 'function') {
        try { await window.wipeFitnessInputs(); } catch (e) { console.warn('wipe: fitness cache skipped', e); }
      }
      APP_STATE.selectedClientId = null;
      // Admin credentials are restored to the hardcoded config values — they
      // survive every wipe by design.
      APP_STATE.adminConfig = {
        admin_login_id: APP_CONFIG.DEFAULT_ADMIN_ID,
        admin_password: APP_CONFIG.DEFAULT_ADMIN_PW,
        archive_email: APP_STATE.adminConfig.archive_email || 'trainer@example.com'
      };

      renderClientList();
      updateApprovalsBadge();
      $('adminDisplayId').textContent = APP_STATE.adminConfig.admin_login_id;
      $('clientDetailPanel').classList.add('hidden');
      $('noClientSelectedMsg').classList.remove('hidden');
      $('settingsPanel').classList.add('hidden');
      $('libraryPanel').classList.add('hidden');
      $('approvalsPanel').classList.add('hidden');

      showStatus($('clearAllStatus'), '✅ Report emailed. All data wiped.', 'success');
      setTimeout(() => {
        $('clearAllModal').classList.add('hidden');
        unifiedLogout();
      }, 2000);
    } catch (err) {
      showStatus($('clearAllStatus'), `❌ Wipe failed: ${err.message}`, 'error');
      btn.disabled = false;
      btn.textContent = '📧 Email & Wipe';
    }
  }, 3000);
};

window.openDeleteClientModal = function () {
  if (!APP_STATE.selectedClientId) return;
  APP_STATE.pendingDeleteClientId = APP_STATE.selectedClientId;
  $('deleteClientModal').classList.remove('hidden');
  $('deleteConfirmInput').value = '';
  $('confirmDeleteClientBtn').disabled = true;
  clearStatus($('deleteClientStatus'));
};