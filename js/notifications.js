/* ============================================================
   🔔 NOTIFICATIONS — popup + BEEP + app-icon badge alert
   ------------------------------------------------------------
   Works for BOTH portals:
     • Admin/trainer → notified when a client submits an approval
       or sends an edit request.
     • Client        → notified when the trainer sets a class time,
       assigns a new exercise or marks a session done.
   Every alert:
     1. shows a system Notification (visible even when the app is
        installed as a PWA / running in a background tab),
     2. plays a short double-BEEP (WebAudio, no audio files needed),
     3. raises a RED BADGE on the in-app bell AND on the browser tab
        title ("(3) …") so it's obvious something is waiting.
   The polling loop runs once per minute as a safety net; Supabase
   Realtime (js/realtime.js) also pokes it instantly when available.
   ============================================================ */

/* ---------- tiny WebAudio beep engine ---------- */
(function () {
  let ctx = null;
  function getCtx() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    } catch (e) { return null; }
  }
  function beepOnce(ac, t0, freq) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.20);
    o.connect(g).connect(ac.destination);
    o.start(t0); o.stop(t0 + 0.22);
  }
  // Two-tone "ding-ding" alert — pleasant but impossible to ignore.
  window.playNotificationBeep = function () {
    const ac = getCtx();
    if (!ac) return;
    const t = ac.currentTime;
    beepOnce(ac, t, 880);
    beepOnce(ac, t + 0.26, 1245);
  };
})();

/* ---------- in-app bell + tab-title badge + PWA app-icon badge ---------- */
// Real "dot on the installed app icon" via the Badging API (Chrome/Edge
// desktop + Android PWAs). Falls back to the tab-title "(n)" badge.
async function updateAppIconBadge(n) {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    if ('setAppBadge' in reg) {
      if (n > 0) await reg.setAppBadge(n);
      else await reg.clearAppBadge();
    } else if ('BadgingManager' in window) {
      // Future standard API name — support it if browsers ship it.
      await new window.BadgingManager().set(n > 0 ? { label: String(n), content: n } : null);
    }
  } catch (e) { /* badging unsupported — tab title still shows the count */ }
}

window.updateAlertBadge = function () {
  const n = APP_STATE.unreadAlerts || 0;
  const b = $('notifyBtn');
  if (b) {
    let cnt = b.querySelector('.bell-badge');
    if (n > 0) {
      if (!cnt) {
        cnt = document.createElement('span');
        cnt.className = 'bell-badge';
        b.appendChild(cnt);
      }
      cnt.textContent = n > 9 ? '9+' : String(n);
      b.classList.add('has-alert', 'alert-shake');
      setTimeout(() => b.classList.remove('alert-shake'), 1600);
    } else {
      if (cnt) cnt.remove();
      b.classList.remove('has-alert', 'alert-shake');
    }
  }
  // Browser-tab alert — acts like the notification dot on the
  // installed app icon while the portal tab/app window is open.
  try {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
    document.title = n > 0 ? `(${n}) ${base}` : base;
  } catch (e) {}
  // Actual app-icon badge on installed PWAs (notification dot on the icon).
  updateAppIconBadge(n);
};

window.clearAlertBadge = function () {
  APP_STATE.unreadAlerts = 0;
  updateAlertBadge();
};

/* ---------- core: fire one alert (popup + beep + badge) ---------- */
window.fireAlertNotification = function (title, body, tag) {
  APP_STATE.unreadAlerts = (APP_STATE.unreadAlerts || 0) + 1;
  try { updateAlertBadge(); } catch (e) {}
  try { playNotificationBeep(); } catch (e) {}
  if (typeof showToast === 'function') {
    try { showToast('🔔 ' + title + (body ? ' — ' + body : ''), 'info', 4200); } catch (e) {}
  }
  if (APP_STATE.notificationsEnabled && ('Notification' in window) && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, {
        body: body || '',
        tag: tag || 'tas-alert',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        vibrate: [180, 90, 180],
        requireInteraction: false
      });
      n.onclick = function () {
        try { window.focus(); clearAlertBadge(); } catch (e) {}
        n.close();
      };
    } catch (e) {}
  }
};

// One shared permission handler for BOTH bell buttons — admin (notifyBtn)
// and client (clientNotifyBtn). Clicking "🔔 Enable" requests the browser
// notification permission; granting it immediately syncs the state across
// both portals so the two buttons never disagree.
window.requestNotifyPermission = async function () {
  if (!('Notification' in window)) {
    showStatus(null, '⚠️ Notifications are not supported on this browser.', 'warning');
    updateNotifyButtons();
    return;
  }
  let perm = Notification.permission;
  if (perm !== 'granted') {
    try { perm = await Notification.requestPermission(); }
    catch (e) { perm = Notification.permission; }
  }
  if (perm === 'granted') {
    APP_STATE.notificationsEnabled = true;
    try { new Notification('🔔 Notifications enabled', { body: 'You will be alerted of every new update.', icon: 'icons/icon-192.png' }); } catch (e) {}
    try { playNotificationBeep(); } catch (e) {}
    if (typeof showToast === 'function') showToast('🔔 Notifications are ON — you will hear an alert for every update.', 'success', 3500);
  } else if (perm === 'denied') {
    APP_STATE.notificationsEnabled = false;
    if (typeof showToast === 'function') showToast('🔕 Notifications blocked by the browser. Enable them in your site settings.', 'warning', 4500);
  }
  // Redraw EVERY notify button (admin + client) so state stays in sync.
  updateNotifyButtons();
};

// Paint a single button from the live Notification.permission state.
function paintNotifyButton(btn) {
  if (!btn) return;
  if (!('Notification' in window)) { btn.textContent = '🔔 N/A'; btn.disabled = true; return; }
  btn.disabled = false;
  if (Notification.permission === 'granted') {
    btn.innerHTML = '🔔 On';
    btn.classList.add('enabled');
    APP_STATE.notificationsEnabled = true;
  } else if (Notification.permission === 'denied') {
    btn.innerHTML = '🔕 Blocked';
    btn.classList.remove('enabled');
    btn.disabled = true;
  } else {
    btn.innerHTML = '🔔 Enable';
    btn.classList.remove('enabled');
    if (!APP_STATE.loggedInClient) APP_STATE.notificationsEnabled = false;
  }
}

window.updateNotifyButton = function () {
  paintNotifyButton($('notifyBtn'));
  paintNotifyButton($('clientNotifyBtn'));
  if (Notification && Notification.permission === 'granted') APP_STATE.notificationsEnabled = true;
  // Re-attach the unread badge if one is active after a re-render.
  try { updateAlertBadge(); } catch (e) {}
};

// Sync ALL notify buttons at once (admin ↔ client portals).
window.updateNotifyButtons = window.updateNotifyButton;

// Bind the client-portal bell too — previously only the admin button had a
// click handler, so the client "Enable" button did nothing.
window.bindClientNotifyButton = function () {
  const cb = $('clientNotifyBtn');
  if (!cb || cb.dataset.bound === '1') return;
  cb.dataset.bound = '1';
  cb.addEventListener('click', () => {
    if (typeof window.requestNotifyPermission === 'function') window.requestNotifyPermission();
  });
};

/* ---------- ADMIN side: approvals & edit requests ---------- */
// Uses the SHARED getTruePendingCounts() so ghost / legacy / stale rows
// can never inflate the alert count or fire false notifications.
window.checkForNewApprovalsAndNotify = function () {
  const totalPending = window.getTruePendingCounts ? window.getTruePendingCounts().total
    : (APP_STATE.profileApprovals.filter(a => a.status === 'pending').length
      + APP_STATE.progressApprovals.filter(a => a.status === 'pending').length
      + (APP_STATE.workoutEditRequests || []).filter(r => r.status === 'pending').length);
  const last = APP_STATE.lastSeenApprovalCount;
  if (last > 0 && totalPending > last) {
    const diff = totalPending - last;
    fireAlertNotification('🔔 New approval' + (diff > 1 ? 's' : ''),
      `${diff} new pending item${diff > 1 ? 's' : ''} waiting for you.`, 'approvals');
  }
  APP_STATE.lastSeenApprovalCount = totalPending;
};

/* ---------- CLIENT side: anything the trainer changed ---------- */
// Snapshot of everything that matters to the logged-in client:
// class times, assigned plan, finished sessions, progress entries.
// Stored as flat signature strings + raw lists for message details.
function clientSnapshot(c) {
  const [y, m] = getViewYearMonth();
  const dtList = (clientMapGet(APP_STATE.dailyTimesCache, c.id) || []).slice();
  const exList = (clientMapGet(APP_STATE.clientExercisesCache, c.id) || []).slice();
  const dt = dtList.map(d => `${d.day_date}@${d.class_time || ''}`).sort().join('|');
  const ex = exList.map(e => `${e.id}-${e.name || ''}-${e.sets || ''}-${e.reps || ''}-${e.weight || ''}`).sort().join('|');
  const sess = getSessions(c.id, y, m).map(s => s.day).sort((a, b) => a - b).join(',');
  const progList = APP_STATE.progressEntries[c.id] || [];
  const prog = progList.map(p => p.id ?? p.entry_date).sort().join('|');
  return { dt, ex, sess, prog, _dtList: dtList };
}

window.checkClientUpdatesAndNotify = function () {
  const c = APP_STATE.loggedInClient;
  if (!c) return;
  let snap;
  try { snap = clientSnapshot(c); } catch (e) { return; }
  const prev = APP_STATE.clientSnapshot;
  APP_STATE.clientSnapshot = snap;
  if (!prev) return; // first sync after login — nothing to compare yet

  if (prev.dt !== snap.dt) {
    // Find which day's time actually changed for a meaningful message.
    const before = Object.fromEntries((prev._dtList || []).map(d => [d.day_date, d.class_time]));
    const after = snap._dtList || [];
    const changed = after.find(d => before[d.day_date] !== undefined && before[d.day_date] !== d.class_time)
      || after.find(d => before[d.day_date] === undefined);
    const when = changed ? changed.day_date : 'your schedule';
    const time = changed && changed.class_time ? ` at ${changed.class_time}` : '';
    fireAlertNotification('⏰ Class time updated', `Your trainer set ${when}${time}.`, 'class-time');
  }
  if (prev.ex !== snap.ex) {
    fireAlertNotification('🏋️ New plan update', 'Your trainer changed your exercise plan — check My Plan.', 'plan');
  }
  if (prev.sess !== snap.sess) {
    fireAlertNotification('✅ Session update', 'A training session was marked on your calendar.', 'session');
  }
  if (prev.prog !== snap.prog) {
    fireAlertNotification('📊 Progress update', 'New progress data is available in your portal.', 'progress');
  }
};

/* ---------- shared polling loop (admin OR client) ---------- */
window.startNotificationPolling = function () {
  if (APP_STATE.notificationPollHandle) clearInterval(APP_STATE.notificationPollHandle);
  const tick = async () => {
    const isAdmin = !$('adminDashboard').classList.contains('hidden');
    const isClient = !!APP_STATE.loggedInClient;
    if (!isAdmin && !isClient) return;
    if (document.hidden && !isClient && !isAdmin) return;
    try {
      const sb = APP_STATE.supabaseClient;
      if (!sb) return;
      if (isAdmin) {
        const { data: pa } = await sb
          .from('profile_approvals').select('*').order('submitted_at', { ascending: false });
        APP_STATE.profileApprovals = pa || [];
        const { data: pg } = await sb
          .from('progress_approvals').select('*').order('submitted_at', { ascending: false });
        APP_STATE.progressApprovals = pg || [];
        updateApprovalsBadge();
        checkForNewApprovalsAndNotify();
        if (!$('approvalsPanel').classList.contains('hidden')) renderApprovals();
        renderClientList();
      } else if (isClient) {
        // Lightweight targeted refresh of just what the client sees,
        // then diff against the last snapshot to raise alerts.
        const cid = APP_STATE.loggedInClient.id;
        const [y, m] = getViewYearMonth();
        const { data: dt } = await sb.from('daily_times').select('*').eq('client_id', cid);
        clientMapSet(APP_STATE.dailyTimesCache, cid, dt || []);
        const { data: ce } = await sb.from('client_exercises').select('*').eq('client_id', cid);
        clientMapSet(APP_STATE.clientExercisesCache, cid, ce || []);
        const { data: sess } = await sb.from('sessions').select('*')
          .eq('client_id', cid)
          .gte('session_date', `${y}-${String(m + 1).padStart(2, '0')}-01`)
          .lte('session_date', `${y}-${String(m + 1).padStart(2, '0')}-31`);
        const k = getSessionCacheKey(cid, y, m);
        APP_STATE.sessionCache[k] = (sess || []).map(s => ({
          day: Number(String(s.session_date).slice(8, 10)), checked_at: s.checked_at
        }));
        const { data: pe } = await sb.from('progress_entries').select('*').eq('client_id', cid)
          .order('entry_date', { ascending: false });
        APP_STATE.progressEntries[cid] = pe || [];
        checkClientUpdatesAndNotify();
        renderClientDashboard(APP_STATE.loggedInClient);
      }
    } catch (e) { /* offline — retry next tick */ }
  };
  // First pass primes the snapshots quietly (no alerts on login).
  tick().catch(() => {});
  APP_STATE.notificationPollHandle = setInterval(tick, 60000);
};

/* ---------- Realtime hook: instant alerts, not just 60s polls ---------- */
// js/realtime.js calls scheduleLiveReload() on any table change; we also
// piggy-back here so alerts fire within seconds when Realtime works.
// IMPORTANT: this runs BEFORE loadAllData() finishes, so the caches still
// hold pre-change data. We only keep the old snapshots here (so the diff
// has something to compare against) and evaluate once fresh data lands.
window.notifyFromRealtime = function () {
  const c = APP_STATE.loggedInClient;
  if (c) {
    try { APP_STATE.clientSnapshot = clientSnapshot(c); } catch (e) {}
  } else if (typeof $ === 'function' && $('adminDashboard') && !$('adminDashboard').classList.contains('hidden')) {
    // Count current pendings now (pre-reload); the post-reload call below
    // compares the new count against it and alerts if something arrived.
    try {
      APP_STATE.lastSeenApprovalCount = window.getTruePendingCounts
        ? window.getTruePendingCounts().total
        : (APP_STATE.profileApprovals.filter(a => a.status === 'pending').length +
           APP_STATE.progressApprovals.filter(a => a.status === 'pending').length +
           (APP_STATE.workoutEditRequests || []).filter(r => r.status === 'pending').length);
    } catch (e) {}
  }
  // Re-check after the live reload has fetched the fresh rows.
  setTimeout(() => {
    try {
      if (APP_STATE.loggedInClient) checkClientUpdatesAndNotify();
      else if (typeof $ === 'function' && $('adminDashboard') && !$('adminDashboard').classList.contains('hidden')) {
        checkForNewApprovalsAndNotify();
      }
    } catch (e) {}
  }, 1800);
};

// Opening the dashboard area acknowledges the alerts (badge clears),
// mirroring how native apps clear the icon dot when you open them.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) setTimeout(() => { try { clearAlertBadge(); } catch (e) {} }, 1500);
});
