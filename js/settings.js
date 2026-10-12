// All top-bar admin panels live inside the "📋 Clients" workspace, so every
// open helper must switch to that workspace first — otherwise the panel is
// un-hidden but stays invisible behind the Home screen ("button not working").
const ADMIN_PANEL_IDS = ['settingsPanel', 'libraryPanel', 'approvalsPanel', 'classTimesPanel', 'requestsPanel', 'reportsPanel'];

window.hideAllAdminPanels = function () {
  ADMIN_PANEL_IDS.forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
};

window.showAdminPanel = function (id, renderFnName) {
  if (typeof window.showAdminWorkspaceTab === 'function') window.showAdminWorkspaceTab('clients');
  const panel = $(id);
  if (!panel) return false;
  const wasHidden = panel.classList.contains('hidden');
  ADMIN_PANEL_IDS.forEach(other => {
    if (other !== id) { const el = $(other); if (el) el.classList.add('hidden'); }
  });
  panel.classList.toggle('hidden', !wasHidden); // click again = close
  if (!panel.classList.contains('hidden') && typeof window[renderFnName] === 'function') {
    try { window[renderFnName](); } catch (e) { console.warn(renderFnName, e); }
  }
  return true;
};

window.openSettingsPanel = function () {
  showAdminPanel('settingsPanel');
  if ($('settingsPanel') && !$('settingsPanel').classList.contains('hidden')) {
    $('settingsLoginId').value = APP_STATE.adminConfig.admin_login_id || APP_CONFIG.DEFAULT_ADMIN_ID;
    $('settingsArchiveEmail').value = APP_STATE.adminConfig.archive_email || '';
  }
};

window.openApprovalsPanel = function () {
  showAdminPanel('approvalsPanel', 'renderApprovals');
};

window.openLibraryPanel = function () {
  showAdminPanel('libraryPanel', 'renderLibrary');
};

window.saveSettings = async function () {
  const newLoginId = $('settingsLoginId').value.trim();
  const currentPw = $('settingsCurrentPassword').value.trim();
  const newPw = $('settingsNewPassword').value.trim();
  const confirmPw = $('settingsConfirmPassword').value.trim();
  const newEmail = $('settingsArchiveEmail').value.trim();

  if (currentPw !== APP_STATE.adminConfig.admin_password) {
    showStatus($('settingsStatus'), '⛔ Current password wrong.', 'error');
    return;
  }
  const updates = {};
  if (newLoginId && newLoginId !== APP_STATE.adminConfig.admin_login_id) updates.admin_login_id = newLoginId;
  if (newPw || confirmPw) {
    if (newPw.length < 4) { showStatus($('settingsStatus'), '⚠️ Password min 4 chars.', 'error'); return; }
    if (newPw !== confirmPw) { showStatus($('settingsStatus'), '⚠️ Passwords do not match.', 'error'); return; }
    updates.admin_password = newPw;
  }
  if (newEmail && newEmail !== APP_STATE.adminConfig.archive_email) updates.archive_email = newEmail;
  if (Object.keys(updates).length === 0) { showStatus($('settingsStatus'), 'ℹ️ No changes.', 'info'); return; }
  updates.updated_at = new Date().toISOString();
  try {
    $('saveSettingsBtn').disabled = true;
    const { error } = await APP_STATE.supabaseClient.from('admin_config').update(updates).eq('id', 1);
    if (error) throw error;
    Object.assign(APP_STATE.adminConfig, updates);
    $('adminDisplayId').textContent = APP_STATE.adminConfig.admin_login_id;
    showStatus($('settingsStatus'), '✅ Saved!', 'success');
    $('settingsCurrentPassword').value = '';
    $('settingsNewPassword').value = '';
    $('settingsConfirmPassword').value = '';
  } catch (err) {
    showStatus($('settingsStatus'), `❌ ${err.message}`, 'error');
  } finally {
    $('saveSettingsBtn').disabled = false;
  }
};

window.initPasswordToggles = function () {
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const t = document.getElementById(btn.dataset.target);
      if (t) {
        t.type = t.type === 'password' ? 'text' : 'password';
        btn.textContent = t.type === 'password' ? '👁️' : '🙈';
      }
    });
  });
};

window.updateRatePerSession = async function () {
  if (!APP_STATE.selectedClientId) return;
  const input = $('ratePerSession');
  let r = parseFloat(input.value);
  if (isNaN(r) || r < 1) r = 200;
  input.value = Math.round(r);
  await APP_STATE.supabaseClient.from('client_settings').update({ rate_aed: r }).eq('client_id', APP_STATE.selectedClientId);
  if (clientMapGet(APP_STATE.clientSettings, APP_STATE.selectedClientId)) clientMapGet(APP_STATE.clientSettings, APP_STATE.selectedClientId).rate_aed = r;
  renderSessions();
  renderClientList();
  document.querySelectorAll('.client-item').forEach(el =>
    el.classList.toggle('active-client', sameId(el.dataset.clientId, APP_STATE.selectedClientId)));
};

window.changeMonth = function (e) {
  APP_STATE.selectedMonth = parseInt(e.target.value, 10);
  // BUG FIX: keep the view year in sync — December viewed in January must be
  // last year, January viewed in December must be next year. Previously the
  // grid always used CURRENT_YEAR, misplacing sessions around year ends.
  APP_STATE.selectedYear = (() => {
    const cur = new Date();
    if (APP_STATE.selectedMonth > cur.getMonth()) return cur.getFullYear() - 1;
    if (APP_STATE.selectedMonth < cur.getMonth() - 6) return cur.getFullYear() + 1;
    return cur.getFullYear();
  })();
  APP_STATE.selectedDay = null;
  if (APP_STATE.selectedClientId) renderSessions();
};