window.buildReminderMessage = function (c) {
  const rs = clientMapGet(APP_STATE.clientSettings, c.id) || {};
  const note = rs.note || '';
  const noteStr = note ? `\n\n📝 Note: ${note}` : '';
  const creds = `\n\n🔑 Your login details:\n🌐 ${APP_CONFIG.LOGIN_URL}\nLogin ID: ${c.login_id}\nPassword: ${c.password_hint}`;
  return `Hi ${c.name},\n\nYour schedule has been updated. Please check the app for your class time and progress.${noteStr}${creds}\n\nSee you there! 💪`;
};

window.buildBroadcastMessage = function (c) {
  const rs = clientMapGet(APP_STATE.clientSettings, c.id) || {};
  const note = rs.note || '';
  const noteStr = note ? `\n\n📝 Note: ${note}` : '';
  return `Hi ${c.name},\n\nThis is an announcement from your trainer.${noteStr}\n\nPlease open the app to check your schedule and updates. 💪`;
};

window.updateReminderPreview = function () {
  if (!APP_STATE.selectedClientId) return;
  const c = getClient(APP_STATE.selectedClientId); if (!c) return;
  const note = $('reminderNote').value.trim();
  const noteStr = note ? `\n\n📝 Note: ${note}` : '';
  const creds = `\n\n🔑 Your login details:\n🌐 ${APP_CONFIG.LOGIN_URL}\nLogin ID: ${c.login_id}\nPassword: ${c.password_hint}`;
  $('reminderPreviewText').textContent = `Hi ${c.name},\n\nYour schedule has been updated. Please check the app for your class time and progress.${noteStr}${creds}\n\nSee you there! 💪`;
};

window.saveReminderNote = async function () {
  if (!APP_STATE.selectedClientId) return;
  const note = $('reminderNote').value.trim();
  try {
    await APP_STATE.supabaseClient.from('client_settings').update({ note }).eq('client_id', APP_STATE.selectedClientId);
    if (clientMapGet(APP_STATE.clientSettings, APP_STATE.selectedClientId)) clientMapGet(APP_STATE.clientSettings, APP_STATE.selectedClientId).note = note;
  } catch (err) {}
  updateReminderPreview();
};

window.sendReminder = function (method) {
  if (!APP_STATE.selectedClientId) return;
  const c = getClient(APP_STATE.selectedClientId); if (!c) return;
  if (!c.active) { showStatus($('reminderStatus'), `⚠️ ${c.name} is CLOSED.`, 'error'); return; }
  const msg = buildReminderMessage(c);
  const enc = encodeURIComponent(msg);
  if (method === 'whatsapp') {
    const phone = (c.phone || '').replace(/\D/g, '');
    if (!phone) { showStatus($('reminderStatus'), '⚠️ No number.', 'error'); return; }
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const waUrl = isMobile ? `whatsapp://send?phone=${phone}&text=${enc}` : `https://wa.me/${phone}?text=${enc}`;
    window.open(waUrl, '_blank');
    showStatus($('reminderStatus'), `✅ WhatsApp opened`, 'success');
  } else {
    if (!c.email) { showStatus($('reminderStatus'), '⚠️ No email.', 'error'); return; }
    const subj = `Schedule Updated — ${c.name}`;
    window.location.href = `mailto:${c.email}?subject=${encodeURIComponent(subj)}&body=${enc}`;
    showStatus($('reminderStatus'), `✅ Email opened`, 'success');
  }
  setTimeout(() => clearStatus($('reminderStatus')), 5000);
};

window.sendToAllClients = async function () {
  const active = APP_STATE.clients.filter(c => c.active);
  if (active.length === 0) { showStatus($('sendAllTopStatus'), '⚠️ No active clients.', 'error'); return; }
  const ready = active.filter(c => c.phone && c.phone.replace(/\D/g, ''));
  const missing = active.filter(c => !c.phone || !c.phone.replace(/\D/g, ''));
  if (ready.length === 0) { showStatus($('sendAllTopStatus'), '⚠️ No active client has a WhatsApp number.', 'error'); return; }
  const confirmMsg = `Send announcement to ${ready.length} active client${ready.length > 1 ? 's' : ''}?`
    + (missing.length ? `\n\n(Skipping ${missing.length} without a phone: ${missing.map(x => x.name).join(', ')})` : '');
  if (!await uiConfirm({ title: '📢 Broadcast Announcement', message: confirmMsg, confirmText: '📱 Send Now' })) return;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  ready.forEach((c, i) => {
    const msg = buildBroadcastMessage(c);
    const phone = c.phone.replace(/\D/g, '');
    setTimeout(() => {
      const waUrl = isMobile
        ? `whatsapp://send?phone=${phone}&text=${encodeURIComponent(msg)}`
        : `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
      window.open(waUrl, '_blank');
    }, i * 400);
  });
  showStatus($('sendAllTopStatus'), `✅ Opening ${ready.length} WhatsApp tab${ready.length > 1 ? 's' : ''}` + (missing.length ? ` · skipped ${missing.length}` : ''), 'success');
  setTimeout(() => clearStatus($('sendAllTopStatus')), 8000);
};