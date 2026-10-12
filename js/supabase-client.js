window.initSupabase = async function () {
  try {
    // Wait for the Supabase CDN to finish loading (max ~8s)
    let tries = 0;
    while (typeof window.supabase === 'undefined' && tries < 40) {
      await new Promise(r => setTimeout(r, 200));
      tries++;
    }
    if (typeof window.supabase === 'undefined') {
      throw new Error('Supabase SDK failed to load from CDN. Check your network/ad-blocker.');
    }

    APP_STATE.supabaseClient = window.supabase.createClient(
      APP_CONFIG.SUPABASE_URL,
      APP_CONFIG.SUPABASE_ANON_KEY
    );

    const { error } = await APP_STATE.supabaseClient.from('clients').select('id').limit(1);
    if (error) throw error;

    setCloudStatus(true);
    // Self-heal known schema drift (missing columns on tables this app uses)
    // BEFORE loading data — best effort, never blocks the app.
    try { await window.repairKnownSchemas(); } catch (e) { console.warn('schema repair skipped:', e); }
    await loadAdminConfig();
    await loadAllData();
    if (typeof window.initRealtimeSync === 'function') window.initRealtimeSync();
    // Single-device login: if THIS device logged in earlier and never
    // logged out, skip the login form and restore the dashboard.
    try {
      if (typeof window.tryRestoreDeviceSession === 'function') window.tryRestoreDeviceSession();
    } catch (e) { console.warn('session restore skipped:', e); }
    showToast('☁️ Connected to cloud — data loaded. 📡 Live sync on.', 'success', 2500);
  } catch (err) {
    console.error('Init failed:', err);
    setCloudStatus(false);
    const statusEl = $('cloudStatusText');
    if (statusEl) statusEl.innerHTML = `⚠️ Offline · <button class="btn-retry" id="retryConnectBtn">↻ Retry</button>`;
    const retry = $('retryConnectBtn');
    if (retry) retry.addEventListener('click', () => {
      retry.closest('.cloud-status') && ($('cloudStatusText').textContent = 'Checking...');
      initSupabase();
    });
    showStatus($('unifiedStatus'), '⚠️ ' + err.message, 'error');
  }
};

window.loadAdminConfig = async function () {
  const { data, error } = await APP_STATE.supabaseClient
    .from('admin_config').select('*').eq('id', 1).single();
  if (!error && data) APP_STATE.adminConfig = { ...APP_STATE.adminConfig, ...data };
};

window.loadAllData = async function () {
  const sb = APP_STATE.supabaseClient;

  const { data: cd } = await sb.from('clients').select('*').order('created_at', { ascending: true });
  APP_STATE.clients = cd || [];

  const { data: sd } = await sb.from('client_settings').select('*');
  APP_STATE.clientSettings = {};
  (sd || []).forEach(s => { APP_STATE.clientSettings[s.client_id] = s; });

  const { data: pd } = await sb.from('client_profiles').select('*');
  APP_STATE.clientProfiles = {};
  (pd || []).forEach(p => { APP_STATE.clientProfiles[p.client_id] = p; });

  const { data: pr } = await sb.from('progress_entries').select('*').order('entry_date', { ascending: false });
  APP_STATE.progressEntries = {};
  (pr || []).forEach(p => {
    if (!APP_STATE.progressEntries[p.client_id]) APP_STATE.progressEntries[p.client_id] = [];
    APP_STATE.progressEntries[p.client_id].push(p);
  });

  try {
    const { data: pa, error: paErr } = await sb.from('progress_approvals')
      .select('*').order('submitted_at', { ascending: false });
    if (!paErr) APP_STATE.progressApprovals = pa || [];
  } catch (e) {
    APP_STATE.progressApprovals = [];
  }

  const { data: sess } = await sb.from('sessions').select('*')
    .gte('session_date', `${new Date().getFullYear() - 3}-01-01`)
    .lte('session_date', `${new Date().getFullYear() + 1}-12-31`);
  APP_STATE.sessionCache = {};
  (sess || []).forEach(s => {
    // BUG FIX (phantom dates like "9 October"): Postgres returns DATE columns
    // as plain 'YYYY-MM-DD' strings. `new Date('2026-10-09')` parses that as
    // UTC midnight, so in timezones west of UTC (getMonth()/getDate()) shifts
    // the day BACKWARD and sessions land on the wrong calendar day. Parse the
    // ISO parts directly — no timezone conversion at all.
    const [yy, mm, dd] = String(s.session_date).slice(0, 10).split('-').map(Number);
    if (!yy || !mm || !dd) return;
    const k = getSessionCacheKey(s.client_id, yy, mm - 1);
    if (!APP_STATE.sessionCache[k]) APP_STATE.sessionCache[k] = [];
    // Dedupe: realtime echoes / offline retries can deliver the same row twice.
    if (!APP_STATE.sessionCache[k].some(x => x.day === dd)) {
      APP_STATE.sessionCache[k].push({ day: dd, checked_at: s.checked_at });
    }
  });

  const { data: ex } = await sb.from('exercises').select('*').order('name', { ascending: true });
  APP_STATE.exercises = ex || [];

  const { data: ce } = await sb.from('client_exercises').select('*');
  APP_STATE.clientExercisesCache = {};
  (ce || []).forEach(a => {
    if (!APP_STATE.clientExercisesCache[a.client_id]) APP_STATE.clientExercisesCache[a.client_id] = [];
    APP_STATE.clientExercisesCache[a.client_id].push(a);
  });

  const { data: wl } = await sb.from('workout_logs').select('*')
    .gte('session_date', `${new Date().getFullYear() - 3}-01-01`)
    .lte('session_date', `${new Date().getFullYear() + 1}-12-31`);
  APP_STATE.workoutLogsCache = {};
  (wl || []).forEach(w => {
    const k = `${w.client_id}-${w.session_date}`;
    if (!APP_STATE.workoutLogsCache[k]) APP_STATE.workoutLogsCache[k] = [];
    APP_STATE.workoutLogsCache[k].push(w);
  });

  const { data: dt } = await sb.from('daily_times').select('*');
  APP_STATE.dailyTimesCache = {};
  (dt || []).forEach(d => {
    if (!APP_STATE.dailyTimesCache[d.client_id]) APP_STATE.dailyTimesCache[d.client_id] = [];
    APP_STATE.dailyTimesCache[d.client_id].push(d);
  });

  const { data: pa2 } = await sb.from('profile_approvals').select('*').order('submitted_at', { ascending: false });
  APP_STATE.profileApprovals = pa2 || [];

  // Saved progress reports — table created by sql/progress_reports.sql.
  // Degrade gracefully to localStorage if the migration hasn't been run yet.
  try {
    const { data: rpt, error: rptErr } = await sb.from('progress_reports')
      .select('*').order('created_at', { ascending: false });
    if (!rptErr) APP_STATE.savedReports = rpt || [];
    else if (isMissingTableError(rptErr)) await loadSavedReports();
  } catch (e) { await loadSavedReports(); }

  // Workout edit requests — table created by sql/workout_edit_requests.sql.
  // If the table is missing from the schema cache, attempt an auto-provision
  // once (see ensureWorkoutEditRequestsTable), then degrade gracefully.
  try {
    const { data: wer, error: werErr } = await sb.from('workout_edit_requests')
      .select('*').order('requested_at', { ascending: false });
    if (werErr && isMissingTableError(werErr)) {
      const created = await ensureWorkoutEditRequestsTable();
      if (created) {
        const retry = await sb.from('workout_edit_requests')
          .select('*').order('requested_at', { ascending: false });
        APP_STATE.workoutEditRequests = retry.error ? [] : (retry.data || []);
      } else {
        APP_STATE.workoutEditRequests = [];
      }
    } else {
      APP_STATE.workoutEditRequests = werErr ? [] : (wer || []);
    }
  } catch (e) { APP_STATE.workoutEditRequests = []; }

  updateApprovalsBadge();
  // Keep the client portal's "⏳ Pending approval" banner honest: it now
  // re-evaluates from getTruePendingCounts() after every data load, so a
  // stale/legacy row can never leave it falsely visible.
  if (typeof window.syncClientPendingBanner === 'function') window.syncClientPendingBanner();
  // Render the client roster as soon as data is available — this way the list
  // shows up even before the user logs in, and never gets stuck on "Loading…".
  if (typeof renderClientList === 'function') renderClientList();
  // Keep the admin "Class Times" table in sync: it auto-lists every client,
  // so re-render it whenever fresh client/time data arrives.
  const ctPanel = document.getElementById('classTimesPanel');
  if (ctPanel && !ctPanel.classList.contains('hidden') && typeof renderClassTimesTable === 'function') {
    renderClassTimesTable();
  }
  if (typeof checkForNewApprovalsAndNotify === 'function') checkForNewApprovalsAndNotify();

  // If a client is logged in while data reloads (e.g. refresh after admin
  // changes), keep their portal in sync so newly set exercises/sessions show.
  if (typeof window.refreshClientPortalViews === 'function') window.refreshClientPortalViews();
};

// ------------------------------------------------------------
// Missing-table recovery (e.g. PostgREST schema-cache error 42P01:
// "Could not find the table 'public.workout_edit_requests' ...")
// ------------------------------------------------------------
window.isMissingTableError = function (err) {
  if (!err) return false;
  const msg = String(err.message || '');
  return err.code === '42P01'
    || /could not find the table/i.test(msg)
    || /relation .* does not exist/i.test(msg);
};

// Missing *column* error, e.g. PostgREST PGRST204:
//   "Could not find the 'proposed_action' column of 'workout_edit_requests'
//    in the schema cache"
// This happens when a table was created by an older version of the DDL (or
// PostgREST's schema cache is stale). See repairKnownSchemas() below.
window.isMissingColumnError = function (err) {
  if (!err) return false;
  const msg = String(err.message || '');
  return err.code === 'PGRST204'
    || err.code === '42703'
    || err.code === 'PGRST202'
    || (/could not find the .* column/i.test(msg) && !/table/i.test(msg))
    || (/column .* does not exist/i.test(msg));
};

// Legacy numeric primary keys: Postgres rejects them wherever a uuid is
// expected — "invalid input syntax for type uuid" (SQLSTATE 22P02).
// The fix is a one-time data conversion, see sql/fix_uuid_ids.sql.
window.isUuidSyntaxError = function (err) {
  if (!err) return false;
  const msg = String(err.message || err || '');
  return err.code === '22P02' || /invalid input syntax for type uuid/i.test(msg);
};

// Shared handler for the numeric-id problem: explains exactly which SQL
// files to run in Supabase, then lets the caller stop and refresh.
window.handleUuidIdError = async function () {
  showToast(
    '⚠️ Database upgrade needed: some older records still use numeric IDs. ' +
    'Open Supabase → SQL Editor, paste the contents of sql/schema_complete.sql and click Run ' +
    '(it creates every table with proper UUID ids and is safe to re-run — it keeps all your data). ' +
    'If old rows already exist, also run sql/fix_uuid_ids.sql once to convert their numeric ids to UUIDs. ' +
    'Then press 🔄 Refresh and try again.', 'error', 18000);
  return true;
};

// Pull the "<column>" and "<table>" names out of a PostgREST schema-cache
// message so we know exactly what to re-create.
window.parseSchemaCacheError = function (err) {
  const msg = String((err && err.message) || err || '');
  let col = null, table = null;
  let m = /could not find the '([^']+)'/i.exec(msg);
  if (m) col = m[1];
  if (!col) { m = /column ["']?([a-z_][a-z0-9_]*)["']? (?:of|does not exist)/i.exec(msg); if (m) col = m[1]; }
  m = /(?:column|table) of ['"]?([a-z_][a-z0-9_]*)['"]?/i.exec(msg);
  if (m) table = m[1];
  if (!table) { m = /public\.["']?([a-z_][a-z0-9_]*)["']?/i.exec(msg); if (m) table = m[1]; }
  if (!table) { m = /find the [^']*'([a-z_][a-z0-9_]*)'/i.exec(msg); if (m) table = m[1]; }
  return { column: col, table };
};

// ------------------------------------------------------------
// Column-level recovery: adds a single missing column with a safe
// default (so existing rows get backfilled) and asks PostgREST to
// reload its schema cache. Needs the service-role key in config;
// without it the caller falls back to the SQL-file instructions.
// ------------------------------------------------------------
async function execServiceSql(sql) {
  const key = (APP_CONFIG.SUPABASE_SERVICE_KEY || '').trim();
  if (!key || key === 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE') return false;
  const base = APP_CONFIG.SUPABASE_URL.replace(/\/+$/, '');
  const headers = {
    apikey: key, Authorization: `Bearer ${key}`,
    'Content-Type': 'application/sql', Accept: 'application/json'
  };
  let ran = false;
  try {
    const r1 = await fetch(`${base}/rest/v1/rpc/exec_sql`,
      { method: 'POST', headers, body: JSON.stringify({ query: sql }) });
    if (r1.ok) ran = true;
  } catch (e) { /* ignore */ }
  if (!ran) {
    try {
      const r2 = await fetch(`${base}/sql?schema=public`, { method: 'POST', headers, body: sql });
      if (r2.ok) ran = true;
    } catch (e) { /* ignore */ }
  }
  if (ran) { try { await window.reloadSchemaCache(); } catch (e) { /* ignore */ } }
  return ran;
}

window.addColumnWithDefault = async function (table, column, type, defaultValue) {
  const def = defaultValue == null ? '' : ` default ${defaultValue}`;
  const sql = `alter table public."${table}" add column if not exists "${column}" ${type}${def};`;
  return execServiceSql(sql);
};

// Re-run the idempotent provisioning DDL of a known table (creates the
// table when absent AND adds every missing column via IF NOT EXISTS),
// then force PostgREST to reload its schema cache. Safe to call
// repeatedly. Returns true when the SQL actually executed.
window.runProvisionSql = async function (table) {
  const sql = PROVISION_SQL[table];
  if (!sql) return false;
  return execServiceSql(sql);
};

// ------------------------------------------------------------
// Known schema drift for this app → how to heal it. Every entry maps
// a table to the columns some deployments are missing (older DDL or a
// stale PostgREST schema cache). repairKnownSchemas() runs at boot and
// handleMissingColumnError() runs whenever such an error surfaces.
// ------------------------------------------------------------
const KNOWN_COLUMN_FIXES = {
  workout_edit_requests: [
    ['requested_at', 'timestamptz', 'now()'],
    ['decided_at', 'timestamptz', null],
    ['admin_unlocked', 'boolean', 'false'],
    ['proposed_action', 'text', null],   // edit | add | delete | unlock
    ['entry_log_id', 'text', null],      // workout_logs row the proposal targets
    ['proposed_data', 'jsonb', null]     // staged values — applied only on approval
  ],
};

let _repairInFlight = false;
window.repairKnownSchemas = async function () {
  const sb = APP_STATE.supabaseClient;
  if (!sb || _repairInFlight) return false;
  _repairInFlight = true;
  let healed = false;
  try {
    for (const table of Object.keys(KNOWN_COLUMN_FIXES)) {
      // Cheap probe: order by a column that historically goes missing.
      // No error → schema cache already knows the column, nothing to do.
      const probeCol = 'requested_at';
      const probe = await sb.from(table).select('*').order(probeCol, { ascending: false }).limit(1);
      if (!probe.error) continue;
      if (!(isMissingTableError(probe.error) || isMissingColumnError(probe.error))) continue;
      if (isMissingTableError(probe.error)) {
        if (await window.ensureTableExists(table)) healed = true;
        continue;
      }
      // Table exists but one or more columns are missing from the schema
      // cache — re-run the idempotent DDL (adds every missing column with a
      // safe default, backfills rows) and force PostgREST to reload.
      if (await window.runProvisionSql(table)) healed = true;
    }
  } catch (e) { console.warn('repairKnownSchemas:', e); } finally { _repairInFlight = false; }
  return healed;
};

// Shared handler for "column ... not in the schema cache" errors during a
// user action: heals the schema (create table / add column + cache reload)
// and tells the caller whether the action should be retried.
window.handleMissingColumnError = async function (err) {
  const parsed = window.parseSchemaCacheError(err);
  const table = parsed.table && KNOWN_COLUMN_FIXES[parsed.table] ? parsed.table : 'workout_edit_requests';
  showToast('⚠️ Database column missing — trying to fix automatically…', 'warning', 3000);
  let fixed = false;
  try {
    if (parsed.column) fixed = await window.addColumnWithDefault(table, parsed.column, 'text', null);
    // The generic repair covers every known column of the table (and works
    // even when the error text doesn't name the column).
    if (await window.ensureTableExists(table)) fixed = true;
    if (await window.runProvisionSql(table)) fixed = true;
  } catch (e) { /* ignore */ }
  if (fixed) {
    try { await loadAllData(); } catch (e) { /* ignore */ }
    showToast('✅ Database fixed — please send your request again.', 'success', 5000);
    return true;
  }
  const file = window.sqlFileForTable(table);
  const key = (APP_CONFIG.SUPABASE_SERVICE_KEY || '').trim();
  const prefix = (!key || key === 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE')
    ? '🛠️ One-time setup needed: open Supabase → SQL Editor, paste the contents of '
    : '🛠️ Auto-fix blocked by Supabase security. Please run ';
  showToast(`⚠️ Could not save the change (${parsed.column ? "'" + parsed.column + "' column" : 'schema cache'}). ${prefix}${file} once (Dashboard → SQL Editor → New query → paste → Run), then press 🔄 Refresh and try again.`, 'error', 14000);
  return false;
};

// Shared recovery for missing-table errors: tries to auto-provision the
// needed table(s), reloads app data on success, and always shows
// a clear toast telling the user exactly what to do next. Returns true if the
// caller should retry its action. Accepts an optional array of table names,
// e.g. handleMissingWerTable(['workout_edit_requests']).
window.handleMissingWerTable = async function (tables) {
  const list = Array.isArray(tables) && tables.length ? tables : ['workout_edit_requests'];
  showToast('⚠️ Missing database table — trying to fix automatically…', 'warning', 3000);
  let fixed = false;
  for (const t of list) {
    try { if (await window.ensureTableExists(t)) fixed = true; } catch (e) { /* ignore */ }
  }
  if (fixed) {
    try { await loadAllData(); } catch (e) { /* ignore */ }
    showToast('✅ Table created successfully — please try again now.', 'success', 5000);
    return true;
  }
  const file = window.sqlFileForTable(list[0]);
  const key = (APP_CONFIG.SUPABASE_SERVICE_KEY || '').trim();
  if (!key || key === 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE') {
    showToast(`🛠️ One-time setup needed: open Supabase → SQL Editor, paste the contents of ${file} and click Run. Then press 🔄 Refresh in this app and try again.`, 'error', 12000);
  } else {
    showToast(`🛠️ Auto-create blocked by Supabase security. Please run ${file} once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run), then press 🔄 Refresh and try again.`, 'error', 12000);
  }
  return false;
};

// Reload PostgREST's schema cache (needs the service role key in config).
// Called after a successful DDL so the new table becomes visible immediately
// instead of waiting up to ~60s for the automatic reload.
window.reloadSchemaCache = async function () {
  const key = (APP_CONFIG.SUPABASE_SERVICE_KEY || '').trim();
  if (!key || key === 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE') return false;
  try {
    const base = APP_CONFIG.SUPABASE_URL.replace(/\/+$/, '');
    const r = await fetch(`${base}/rest/v1/rpc/`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    // Not all hosts expose the notification trigger; failure is non-fatal.
    return r.ok;
  } catch (e) { return false; }
};

// Turns raw Postgres/PostgREST errors into a clear, actionable message so UI
// status lines never show scary schema-cache jargon. The message names the
// exact SQL file that creates the missing table.
window.friendlySchemaErrorMessage = function (err) {
  const msg = String((err && err.message) || err || 'Unknown error');
  if (window.isUuidSyntaxError(err)) {
    return 'Older records in the database still use numeric IDs. Run sql/schema_complete.sql once in Supabase → SQL Editor (safe, keeps all data), then run sql/fix_uuid_ids.sql to convert the old rows to UUIDs, press 🔄 Refresh and try again.';
  }
  if (window.isMissingTableError(err)) {
    const m = /public\."?([a-z_]+)"?/i.exec(msg) || /table\s+"?([a-z_]+)/i.exec(msg);
    const table = m ? m[1] : '';
    const file = window.sqlFileForTable(table);
    return `The required table is missing from the database. Click "Fix & Retry" (or run ${file} once in the Supabase SQL editor), then try again.`;
  }
  return msg;
};

// ------------------------------------------------------------
// Generic missing-table auto-provisioning.
// Creates a table on the fly using the service key from config
// (works when the project allows direct SQL via rpc/exec_sql or the
// /sql endpoint). Probes before and after, and returns true only if
// the table is actually usable afterwards. The full DDL also lives in
// sql/schema_complete.sql.
// ------------------------------------------------------------
const PROVISION_SQL = {
  workout_edit_requests: [
    'create table if not exists public.workout_edit_requests (',
    '  id uuid primary key default gen_random_uuid(),',
    '  client_id text not null,',
    '  session_date date not null,',
    "  status text not null default 'pending',",
    '  admin_unlocked boolean not null default false,',
    '  proposed_action text,',
    '  entry_log_id text,',
    '  proposed_data jsonb,',
    '  requested_at timestamptz not null default now(),',
    '  decided_at timestamptz);',
    'create index if not exists wer_status_idx on public.workout_edit_requests (status);',
    "alter table public.workout_edit_requests add column if not exists proposed_action text;",
    "alter table public.workout_edit_requests add column if not exists entry_log_id text;",
    "alter table public.workout_edit_requests add column if not exists proposed_data jsonb;",
    'alter table public.workout_edit_requests enable row level security;',
    'drop policy if exists wer_select on public.workout_edit_requests;',
    'create policy wer_select on public.workout_edit_requests for select using (true);',
    'drop policy if exists wer_insert on public.workout_edit_requests;',
    'create policy wer_insert on public.workout_edit_requests for insert with check (true);',
    'drop policy if exists wer_update on public.workout_edit_requests;',
    'create policy wer_update on public.workout_edit_requests for update using (true) with check (true);'
  ].join('\n'),

  client_requests: [
    'create table if not exists public.client_requests (',
    '  id uuid primary key default gen_random_uuid(),',
    '  client_id text not null,',
    '  session_date date,',
    "  request_type text not null default 'general',",
    '  message text,',
    '  requested_time text,',
    '  requested_new_date date,',
    "  status text not null default 'pending',",
    '  edited_count integer not null default 0,',
    '  last_edited_at timestamptz,',
    '  admin_note text,',
    '  requested_at timestamptz not null default now(),',
    '  decided_at timestamptz);',
    // heal older deployments that were created without these columns
    'alter table public.client_requests add column if not exists requested_time text;',
    'alter table public.client_requests add column if not exists edited_count integer not null default 0;',
    'alter table public.client_requests add column if not exists last_edited_at timestamptz;',
    'alter table public.client_requests add column if not exists admin_note text;',
    'alter table public.client_requests add column if not exists decided_at timestamptz;',
    'alter table public.client_requests add column if not exists requested_at timestamptz not null default now();',
    'create index if not exists cr_status_idx on public.client_requests (status);',
    'create index if not exists cr_client_idx on public.client_requests (client_id);',
    'alter table public.client_requests enable row level security;',
    'drop policy if exists cr_select on public.client_requests;',
    'create policy cr_select on public.client_requests for select using (true);',
    'drop policy if exists cr_insert on public.client_requests;',
    'create policy cr_insert on public.client_requests for insert with check (true);',
    'drop policy if exists cr_update on public.client_requests;',
    'create policy cr_update on public.client_requests for update using (true) with check (true);',
    'drop policy if exists cr_delete on public.client_requests;',
    'create policy cr_delete on public.client_requests for delete using (true);'
  ].join('\n'),


  progress_reports: [
    'create table if not exists public.progress_reports (',
    '  id uuid primary key default gen_random_uuid(),',
    '  client_id text not null,',
    '  month_key text not null,',
    '  period_from text,',
    '  period_to text,',
    "  snapshot jsonb not null default '{}'::jsonb,",
    "  comparison jsonb not null default '{}'::jsonb,",
    '  generated_by text,',
    '  created_at timestamptz not null default now());',
    'create index if not exists pr_client_month_idx on public.progress_reports (client_id, month_key);',
    'alter table public.progress_reports enable row level security;',
    'drop policy if exists pr_select on public.progress_reports;',
    'create policy pr_select on public.progress_reports for select using (true);',
    'drop policy if exists pr_insert on public.progress_reports;',
    'create policy pr_insert on public.progress_reports for insert with check (true);',
    'drop policy if exists pr_delete on public.progress_reports;',
    'create policy pr_delete on public.progress_reports for delete using (true);'
  ].join('\n'),

  // ---- v3 hardening: in-portal messaging ----
  messages: [
    'create table if not exists public.messages (',
    '  id uuid primary key default gen_random_uuid(),',
    '  thread_id text not null,',
    '  client_id text,',
    "  from_role text not null default 'trainer',",
    '  from_name text,',
    '  body text not null,',
    '  created_at timestamptz not null default now());',
    'create index if not exists msg_thread_idx on public.messages (thread_id, created_at);',
    'alter table public.messages enable row level security;',
    'drop policy if exists msg_select on public.messages;',
    'create policy msg_select on public.messages for select using (true);',
    'drop policy if exists msg_insert on public.messages;',
    'create policy msg_insert on public.messages for insert with check (true);'
  ].join('\n'),

  // ---- v3 hardening: periodization program templates ----
  program_templates: [
    'create table if not exists public.program_templates (',
    '  id uuid primary key default gen_random_uuid(),',
    '  name text not null,',
    '  weeks integer not null default 4,',
    '  deload_every integer not null default 0,',
    "  goal text not null default 'general',",
    "  body jsonb not null default '{}'::jsonb,",
    '  updated_at timestamptz not null default now());',
    'alter table public.program_templates enable row level security;',
    'drop policy if exists pt_select on public.program_templates;',
    'create policy pt_select on public.program_templates for select using (true);',
    'drop policy if exists pt_insert on public.program_templates;',
    'create policy pt_insert on public.program_templates for insert with check (true);',
    'drop policy if exists pt_update on public.program_templates;',
    'create policy pt_update on public.program_templates for update using (true) with check (true);',
    'drop policy if exists pt_delete on public.program_templates;',
    'create policy pt_delete on public.program_templates for delete using (true);'
  ].join('\n'),

  // ---- v3 hardening: error tracking (observability) ----
  app_errors: [
    'create table if not exists public.app_errors (',
    '  id uuid primary key default gen_random_uuid(),',
    '  message text,',
    '  stack text,',
    '  page text,',
    '  ua text,',
    '  role text,',
    '  at timestamptz not null default now());',
    'create index if not exists ae_at_idx on public.app_errors (at desc);',
    'alter table public.app_errors enable row level security;',
    'drop policy if exists ae_select on public.app_errors;',
    'create policy ae_select on public.app_errors for select using (true);',
    'drop policy if exists ae_insert on public.app_errors;',
    'create policy ae_insert on public.app_errors for insert with check (true);',
    'drop policy if exists ae_delete on public.app_errors;',
    'create policy ae_delete on public.app_errors for delete using (true);'
  ].join('\n'),

  // ---- v3 hardening: passkeys + device sessions + hashed creds ----
  passkey_credentials: [
    'create table if not exists public.passkey_credentials (',
    '  id uuid primary key default gen_random_uuid(),',
    "  scope text not null default 'client',",
    '  scope_id text not null,',
    '  cred_id text not null unique,',
    '  public_key text,',
    '  public_key_json text,',
    '  label text,',
    '  created_at timestamptz not null default now());',
    'create index if not exists pk_scope_idx on public.passkey_credentials (scope_id);',
    'alter table public.passkey_credentials add column if not exists public_key_json text;',
    'alter table public.passkey_credentials enable row level security;',
    'drop policy if exists pk_select on public.passkey_credentials;',
    'create policy pk_select on public.passkey_credentials for select using (true);',
    'drop policy if exists pk_insert on public.passkey_credentials;',
    'create policy pk_insert on public.passkey_credentials for insert with check (true);',
    'drop policy if exists pk_delete on public.passkey_credentials;',
    'create policy pk_delete on public.passkey_credentials for delete using (true);'
  ].join('\n'),

  device_sessions: [
    'create table if not exists public.device_sessions (',
    '  id text primary key,',
    '  role text not null,',
    '  login_id text not null,',
    '  device_label text,',
    '  region text,',
    '  last_seen_at timestamptz not null default now());',
    'create index if not exists ds_login_idx on public.device_sessions (login_id);',
    'alter table public.device_sessions enable row level security;',
    'drop policy if exists ds_all on public.device_sessions;',
    'create policy ds_all on public.device_sessions for all using (true) with check (true);'
  ].join('\n'),

  client_password_hashes: [
    'create table if not exists public.client_password_hashes (',
    '  login_id text primary key,',
    '  password_hash text not null,',
    '  updated_at timestamptz not null default now());',
    'alter table public.client_password_hashes enable row level security;',
    'drop policy if exists cph_all on public.client_password_hashes;',
    'create policy cph_all on public.client_password_hashes for all using (true) with check (true);'
  ].join('\n'),

  // ---- v3 hardening: hashed admin password column on the existing config row ----
  admin_config: [
    'alter table public.admin_config add column if not exists password_hash text;'
  ].join('\n'),

};

// Remember which tables we already attempted to provision this session so we
// don't hammer the API on every failed call.
const _provisionTried = {};

window.ensureTableExists = async function (table) {
  const sb = APP_STATE.supabaseClient;
  if (!sb || !PROVISION_SQL[table]) return false;

  // One quick probe first — another tab/session may already have created it.
  const probe = await sb.from(table).select('id').limit(1);
  if (!probe.error) return true;
  if (_provisionTried[table]) return false;
  _provisionTried[table] = true;

  const key = (APP_CONFIG.SUPABASE_SERVICE_KEY || '').trim();
  let provisioned = false;
  if (key && key !== 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE') {
    const base = APP_CONFIG.SUPABASE_URL.replace(/\/+$/, '');
    const headers = {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/sql', Accept: 'application/json'
    };
    // Route 1: PostgREST /rpc/exec_sql (Supabase Management API style)
    try {
      const r1 = await fetch(`${base}/rest/v1/rpc/exec_sql`,
        { method: 'POST', headers, body: JSON.stringify({ query: PROVISION_SQL[table] }) });
      if (r1.ok) provisioned = true;
    } catch (e) { /* ignore */ }
    // Route 2: pg-meta /sql endpoint (service-role + application/sql)
    if (!provisioned) {
      try {
        const r2 = await fetch(`${base}/sql?schema=public`,
          { method: 'POST', headers, body: PROVISION_SQL[table] });
        if (r2.ok) provisioned = true;
      } catch (e) { /* ignore */ }
    }
  }

  // Verify by probing again (also covers the case where the table existed
  // but PostgREST's schema cache was simply stale).
  const verify = await sb.from(table).select('id').limit(1);
  if (!verify.error) return true;
  // Table may exist but PostgREST hasn't picked it up yet — ask it to reload.
  if (provisioned) { try { await window.reloadSchemaCache(); } catch (e) {} }
  // PostgREST reloads its schema cache automatically within ~30s of a DDL
  // change, so even if provisioning succeeded we simply report the current
  // state — the caller offers a "Fix & Retry" that re-probes.
  return false;
};

// Back-compat wrapper used by the workout-edit flows.
window.ensureWorkoutEditRequestsTable = () => window.ensureTableExists('workout_edit_requests');

// Which SQL file creates the given table (used in setup instructions).
window.sqlFileForTable = function (table) {
  if (table === 'progress_reports') return 'sql/progress_reports.sql';
  return 'sql/workout_edit_requests.sql';
};

// Pull fresh data from Supabase without losing login state — used by the
// "Refresh" button in both dashboards.
window.refreshAllData = async function () {
  if (!APP_STATE.supabaseClient) { showToast('⏳ Still connecting to the cloud.', 'warning'); return; }
  try {
    await loadAllData();
    showToast('🔄 Data refreshed.', 'success', 2000);
  } catch (err) {
    showToast('❌ Refresh failed: ' + err.message, 'error');
  }
};