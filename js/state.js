// Global mutable state + tiny getters/setters
window.APP_STATE = {
  adminConfig: {
    admin_login_id: APP_CONFIG.DEFAULT_ADMIN_ID,
    admin_password: APP_CONFIG.DEFAULT_ADMIN_PW,
    archive_email: 'trainer@example.com'
  },
  supabaseClient: null,
  clients: [],
  clientSettings: {},
  clientProfiles: {},
  progressEntries: {},
  progressApprovals: [],
  sessionCache: {},
  exercises: [],
  clientExercisesCache: {},
  workoutLogsCache: {},
  dailyTimesCache: {},
  savedReports: [],            // progress_reports rows (cloud) or localStorage fallback
  profileApprovals: [],
  workoutEditRequests: [],   // trainer/admin unlock state for finished day logs
  selectedClientId: null,
  selectedClientForProgress: null,
  selectedMonth: new Date().getMonth(),
  selectedYear: new Date().getFullYear(), // BUG FIX: was missing — every grid
                                           // assumed APP_CONFIG.CURRENT_YEAR, a
                                           // static value frozen at page load,
                                           // so sessions/times landed in the
                                           // wrong year near Jan 1 (phantom
                                           // future dates in client portals)
  selectedDay: null,
  pendingDeleteClientId: null,
  currentApprovalTab: 'pending',
  currentApprovalType: 'profile',
  loggedInClient: null,
  notificationsEnabled: false,
  lastSeenApprovalCount: 0,
  notificationPollHandle: null
};

// Convenience getters
// NOTE: DOM dataset values always come back as strings, while Supabase may
// return ids as numbers (bigserial) or UUID strings. Normalize every id
// comparison with sameId() to avoid strict-equality type mismatches.
window.sameId = (a, b) => String(a ?? '') === String(b ?? '');
// Always resolve the grid's (year, month) from the live clock — never from
// the stale CURRENT_YEAR constant captured when config.js first loaded.
window.getViewYearMonth = () => [APP_STATE.selectedYear || new Date().getFullYear(), APP_STATE.selectedMonth];
window.getSessionCacheKey = (cid, y, m) => `${cid}-${y}-${m}`;
window.getClient = (id) => APP_STATE.clients.find(c => sameId(c.id, id));
window.getRate = (id) => {
  const s = Object.keys(APP_STATE.clientSettings).find(k => sameId(k, id));
  return parseFloat(s ? APP_STATE.clientSettings[s]?.rate_aed : null) || 200;
};
window.getSessions = (cid, y, m) => APP_STATE.sessionCache[getSessionCacheKey(cid, y, m)] || [];
window.getExercise = (id) => APP_STATE.exercises.find(e => sameId(e.id, id));

// Safe lookup in maps keyed by client id (keys may be numeric or string)
window.clientMapGet = function (map, clientId) {
  if (!map) return undefined;
  if (map[clientId] !== undefined) return map[clientId];
  const k = Object.keys(map).find(key => sameId(key, clientId));
  return k !== undefined ? map[k] : undefined;
};

// Safe write into maps keyed by client id (normalizes numeric/string keys)
window.clientMapSet = function (map, clientId, value) {
  const k = Object.keys(map).find(key => sameId(key, clientId));
  map[k !== undefined ? k : clientId] = value;
};

window.getTimeForDate = function (clientId, dateStr) {
  const override = (clientMapGet(APP_STATE.dailyTimesCache, clientId) || []).find(d => d.day_date === dateStr);
  if (override && override.class_time) return { time: override.class_time, isSet: true, note: override.note };
  return { time: null, isSet: false, note: null };
};

window.generateLoginId = function (name, phone) {
  const first = (name || 'user').split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'USER';
  const digits = (phone || '').replace(/\D/g, '');
  const last4 = digits.slice(-4) || String(Math.floor(1000 + Math.random() * 9000));
  let base = `${first}-${last4}`;
  let candidate = base;
  let n = 1;
  while (APP_STATE.clients.some(c => c.login_id === candidate)) candidate = `${base}-${n++}`;
  return candidate;
};

window.generatePassword = function (name) {
  const first = (name || 'X').trim()[0].toUpperCase();
  const last = (name || 'X').trim().split(' ').pop()[0].toUpperCase() || 'Z';
  const num = Math.floor(1000 + Math.random() * 9000);
  const symbols = ['@','#','$','!'];
  const sym = symbols[Math.floor(Math.random() * symbols.length)];
  return `${first}${last}${sym}${num}`;
};

window.getLastLogForExercise = function (clientId, exerciseName, exerciseId, beforeDateISO) {
  const normName = (exerciseName || '').trim().toLowerCase();
  if (!normName && !exerciseId) return null;
  let best = null;
  Object.keys(APP_STATE.workoutLogsCache).forEach(k => {
    if (!k.startsWith(clientId + '-')) return;
    const dateStr = k.substring(clientId.length + 1);
    if (beforeDateISO && dateStr >= beforeDateISO) return;
    const logs = APP_STATE.workoutLogsCache[k] || [];
    logs.forEach(log => {
      const logName = (log.exercise_name || '').trim().toLowerCase();
      const logExId = log.exercise_id || null;
      const matchesId = exerciseId && logExId && String(logExId) === String(exerciseId);
      const matchesName = normName && logName && logName === normName;
      const exNameFromLib = log.exercise_id ? (getExercise(log.exercise_id)?.name || '').trim().toLowerCase() : '';
      const matchesLibName = normName && exNameFromLib && exNameFromLib === normName;
      if (matchesId || matchesName || matchesLibName) {
        if (!best || dateStr > best.dateStr) best = { dateStr, log };
      }
    });
  });
  return best;
};

window.formatLastTimeSummary = function (match) {
  if (!match) return '';
  const { dateStr, log } = match;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  const bits = [];
  if (log.sets_done) bits.push(`${log.sets_done}×`);
  if (log.reps_done) bits.push(log.reps_done);
  if (log.weight_done) bits.push(`@ ${log.weight_done}`);
  if (log.rest_done) bits.push(`rest ${log.rest_done}`);
  return `📌 Last time (${dateLabel}): ${bits.join(' ') || 'no details'}`;
};

window.getWorkoutLogs = (clientId, dateStr) =>
  APP_STATE.workoutLogsCache[`${clientId}-${dateStr}`] || [];

// ============================================================
// Day-lock helpers: once a session is marked finished (checked),
// the workout log for that day becomes read-only until either the
// admin unlocks it manually or approves a client edit request.
// ============================================================
window.isSessionCheckedForDate = function (clientId, dateStr) {
  if (!dateStr) return false;
  const parts = dateStr.split('-').map(Number); // [y, m(1-12), d]
  return getSessions(clientId, parts[0], parts[1] - 1).some(s => s.day === parts[2]);
};

window.getEditRequestFor = function (clientId, dateStr) {
  // Only a live PENDING request counts — an already-approved/rejected one
  // must not keep showing "request pending" chips in the UI.
  return (APP_STATE.workoutEditRequests || []).find(r =>
    sameId(r.client_id, clientId) && r.session_date === dateStr && r.status === 'pending');
};

// 🔒 Pending client-proposed workout-log edits for a day. These are NOT
// applied to workout_logs until the trainer/admin approves them — the client
// can edit freely in their own view, but everyone keeps seeing the approved
// values until then.
window.getPendingLogEditsFor = function (clientId, dateStr) {
  return (APP_STATE.workoutEditRequests || [])
    .filter(r => sameId(r.client_id, clientId) && r.session_date === dateStr && r.status === 'pending')
    .sort((a, b) => String(a.requested_at || '').localeCompare(String(b.requested_at || '')));
};

// True while a day has un-applied client edit proposals waiting for approval.
window.hasPendingLogEdits = function (clientId, dateStr) {
  return getPendingLogEditsFor(clientId, dateStr).length > 0;
};

// ============================================================
// TRUE PENDING COUNTS — single source of truth for every
// "⏳ Pending" badge / banner / stat across BOTH portals.
// ------------------------------------------------------------
// Legacy or ghost rows can carry status='pending' even though the
// request was already decided (missing decided_at), belongs to a
// deleted client, or duplicates an entry that now exists officially.
// These stale rows used to light up the client banner and inflate
// the admin badges with false "Pending approval" states. This
// function filters them out so badges/banners only reflect genuine
// pending requests. js/approvals.js, js/clients.js, js/auth.js,
// js/progress.js, js/workspace.js and js/notifications.js all read
// their counts from here.
// ============================================================
const _PENDING_STALE_MAX_MS = 21 * 24 * 60 * 60 * 1000; // 3 weeks

function _isDecidedAlready(a) {
  // A row that carries a decision timestamp / note / unlock flag but still
  // says 'pending' is a legacy artifact of older approve/reject writes —
  // treat it as decided, not pending.
  return !!(a && (a.decided_at || a.admin_note || a.approved_at));
}

function _isGhostClientRow(a) {
  const cid = a && a.client_id;
  if (cid == null || cid === '') return true;
  return !APP_STATE.clients.some(c => sameId(c.id, cid));
}

function _isStaleSubmitted(a) {
  // Undecided but ancient rows are almost always leftovers from old wipes
  // or abandoned sessions — they should never keep a badge lit forever.
  const ts = Date.parse(a.submitted_at || a.requested_at || '');
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > _PENDING_STALE_MAX_MS;
}

function _progressAlreadyOfficial(a) {
  // An approved 'add' proposal whose entry now lives in progress_entries
  // (same id, or same client + entry_date added by the client) must not be
  // counted as pending anymore.
  if (!a || a.action !== 'add') return false;
  const list = clientMapGet(APP_STATE.progressEntries, a.client_id) || [];
  const pd = a.proposed_data || {};
  return list.some(e =>
    (a.entry_id != null && sameId(e.id, a.entry_id)) ||
    (pd.entry_date && e.entry_date === pd.entry_date && String(e.added_by || '') === 'client'));
}

window.getTruePendingCounts = function () {
  const validClient = a => !_isGhostClientRow(a);
  const genuine = a =>
    a.status === 'pending' && !_isDecidedAlready(a) && validClient(a) && !_isStaleSubmitted(a);

  const profile = (APP_STATE.profileApprovals || []).filter(genuine);
  let progress = (APP_STATE.progressApprovals || []).filter(genuine);
  progress = progress.filter(a => !_progressAlreadyOfficial(a));
  const workout = (APP_STATE.workoutEditRequests || []).filter(r =>
    r.status === 'pending' && !_isDecidedAlready(r) && !_isGhostClientRow(r) && !_isStaleSubmitted(r));

  const perClient = {};
  const bump = (row, kind) => {
    const k = String(row.client_id);
    if (!perClient[k]) perClient[k] = { profile: 0, progress: 0, workout: 0, total: 0 };
    perClient[k][kind]++; perClient[k].total++;
  };
  profile.forEach(a => bump(a, 'profile'));
  progress.forEach(a => bump(a, 'progress'));
  workout.forEach(a => bump(a, 'workout'));

  return {
    profile, progress, workout,
    profileCount: profile.length,
    progressCount: progress.length,
    workoutCount: workout.length,
    total: profile.length + progress.length + workout.length,
    perClient
  };
};

// Genuine pending rows for ONE client (banner / roster badge / chips).
window.getClientPendingRows = function (clientId) {
  const p = window.getTruePendingCounts();
  const e = p.perClient[String(clientId)] || { profile: 0, progress: 0, workout: 0, total: 0 };
  return {
    ...e,
    profileRows: p.profile.filter(a => sameId(a.client_id, clientId)),
    progressRows: p.progress.filter(a => sameId(a.client_id, clientId)),
    workoutRows: p.workout.filter(a => sameId(a.client_id, clientId))
  };
};

window.isDayLogEditable = function (clientId, dateStr) {
  if (!clientId || !dateStr) return true;
  const checked = (APP_STATE.sessionCache[getSessionCacheKey(clientId,
    Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1)] || [])
    .some(s => s.day === Number(dateStr.slice(8, 10)));
  if (!checked) return true; // session still pending (not finished) → fully editable
  // Finished session: editable only when the admin explicitly unlocked it
  // or approved an edit request.
  const row = (APP_STATE.workoutEditRequests || []).find(r =>
    sameId(r.client_id, clientId) && r.session_date === dateStr);
  if (row && (row.admin_unlocked || row.status === 'approved')) return true;
  return false;
};

// All dates that have workout logs OR a finished session for this client.
// Finished sessions are included even when no exercises were logged, so the
// History tab always shows every completed day.
window.getAllWorkoutDates = function (clientId) {
  const dates = new Set();
  Object.keys(APP_STATE.workoutLogsCache).forEach(k => {
    if (k.startsWith(clientId + '-')) dates.add(k.substring(clientId.length + 1));
  });
  Object.keys(APP_STATE.sessionCache).forEach(k => {
    const list = APP_STATE.sessionCache[k] || [];
    list.forEach(s => {
      const parts = String(k).split('-'); // `${cid}-${y}-${m}` — cid may contain '-'
      const y = parseInt(parts[parts.length - 2], 10);
      const m = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(y) && !isNaN(m)) dates.add(formatDateISO(y, m, s.day));
    });
  });
  return Array.from(dates).sort().reverse();
};

// Scheduled class days from today up to `daysAhead` days in the future.
// Includes days whose time is set and days already marked as finished —
// this is what powers the "Upcoming & scheduled classes" card in the
// client portal so nothing the trainer set ever goes invisible.
window.getScheduledDaysAhead = function (clientId, daysAhead = 14) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const dateStr = formatDateISO(d.getFullYear(), d.getMonth(), d.getDate());
    const t = getTimeForDate(clientId, dateStr);
    const done = isSessionCheckedForDate(clientId, dateStr);
    if (!t.isSet && !done) continue;
    out.push({ dateStr, y: d.getFullYear(), m: d.getMonth(), day: d.getDate(), time: t.time, note: t.note, done });
  }
  return out.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
};

window.getWorkoutDisplayName = function (log) {
  if (log.exercise_name && log.exercise_name.trim()) return log.exercise_name.trim();
  if (log.exercise_id) { const ex = getExercise(log.exercise_id); if (ex) return ex.name; }
  return 'Exercise';
};

// ============================================================
// Ordered days for the sessions grid.
// - If viewing the CURRENT month, the list starts at TODAY and
//   continues forward: e.g. Sept 26 → 26, 27, 28, 29, 30, 1, 2, ... 25
// - If viewing any other month, it returns 1, 2, 3, ... lastDay
// ============================================================
window.getOrderedDaysForMonth = function (year, month) {
  const daysInMonth = getDaysInMonth(year, month);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  // Build a normal 1..N array
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  // If not the current month, just return 1..N as before
  if (!isCurrentMonth) return days;

  const currentDay = today.getDate();
  const idx = days.indexOf(currentDay);
  if (idx <= 0) return days; // today is the 1st (or not found) — nothing to rotate

  // Rotate so today is first, then the rest continue in order:
  // [today, today+1, ..., lastDay, 1, 2, ..., today-1]
  return [...days.slice(idx), ...days.slice(0, idx)];
};
// ============================================================
// MONTHLY PROGRESS COMPLIANCE
// ------------------------------------------------------------
// Every client must add at least one progress entry per calendar
// month (from the month they joined onwards). Approved progress
// entries AND pending submissions both count as "submitted"; only
// missing months are flagged red in the admin dashboard.
// ============================================================
window.getMonthKeyFromDateStr = (ds) => ds ? String(ds).slice(0, 7) : '';

window.getClientMonthsSinceJoin = function (c, upToMonthKey) {
  const start = new Date(c.created_at || Date.now());
  const [uy, um] = String(upToMonthKey).split('-').map(Number);
  const end = new Date(uy, um - 1, 1);
  const months = [];
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  // Guard against very old timestamps — cap history at 24 months.
  let guard = 0;
  while (d <= end && guard < 24) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
    guard++;
  }
  return months;
};

window.getProgressCompliance = function (c, upToMonthKey) {
  const entries = clientMapGet(APP_STATE.progressEntries, c.id) || [];
  const approvals = (APP_STATE.progressApprovals || []).filter(a => sameId(a.client_id, c.id));
  const covered = new Set();
  entries.forEach(e => { const k = getMonthKeyFromDateStr(e.entry_date); if (k) covered.add(k); });
  approvals.forEach(a => {
    const k = getMonthKeyFromDateStr((a.proposed_data || {}).entry_date);
    if (k) covered.add(k);
  });
  const months = getClientMonthsSinceJoin(c, upToMonthKey);
  const missing = months.filter(m => !covered.has(m));
  return { months, covered, missing, compliant: missing.length === 0 };
};
