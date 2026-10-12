// DOM + formatting helpers + UI status helpers
window.$ = (id) => document.getElementById(id);

window.escapeHtml = (t) => {
  const d = document.createElement('div');
  d.textContent = t ?? '';
  return d.innerHTML;
};

window.showStatus = function (el, msg, type = 'error') {
  // Inline status element (kept for context-sensitive panels)…
  if (el) {
    el.textContent = msg;
    el.className = 'status-msg';
    if (type === 'success') el.classList.add('status-success');
    else if (type === 'error') el.classList.add('status-error');
    else if (type === 'info') el.classList.add('status-info');
    else if (type === 'warning') el.classList.add('status-warning');
    if (type !== 'info') setTimeout(() => {
      if (el.textContent === msg) { el.textContent = ''; el.className = 'status-msg'; }
    }, 5000);
  }
  // …plus a professional floating toast so feedback is always visible.
  if (typeof window.showToast === 'function' && msg) {
    window.showToast(String(msg).replace(/^[✅❌⚠️ℹ️📧⏳🗑️💾📩]+\s*/, ''), type);
  }
};

// ============================================================
// Trainer WhatsApp alerts — whenever a client sends any request
// (edit a finished day, profile change, progress entry) the app
// opens a WhatsApp chat to the trainer with the details so they
// can do the needful. Number lives in APP_CONFIG.TRAINER_WHATSAPP.
// ============================================================
window.notifyTrainerWhatsApp = function (message) {
  try {
    const raw = String((APP_CONFIG && APP_CONFIG.TRAINER_WHATSAPP) || '').replace(/\D/g, '');
    if (!raw) return false;
    const enc = encodeURIComponent(message);
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const url = isMobile
      ? `whatsapp://send?phone=${raw}&text=${enc}`
      : `https://wa.me/${raw}?text=${enc}`;
    window.open(url, '_blank');
    return true;
  } catch (e) { console.warn('trainer whatsapp alert failed', e); return false; }
};

window.isTrainerSession = function () {
  try { return sessionStorage.getItem('tas_trainer_session') === '1'; } catch (e) { return false; }
};

/* ============================================================
   MULTI-LOGIN SESSION STORE  (device-local, never cloud)
   ------------------------------------------------------------
   • Every login is stored ONLY in this browser's localStorage —
     nothing about a login is ever written to Supabase/the cloud,
     so opening an ID on one device can NEVER auto-open it on
     another device.
   • Sessions are keyed by role + login id, so MANY different
     IDs can be remembered side-by-side in the same browser
     (switch accounts freely — each one restores its own last
     login when you enter it again).
   • A legacy single-slot record from older builds is migrated
     automatically and then removed.
   ============================================================ */
const TAS_SESSIONS_KEY = 'tas_device_sessions_v2';
const TAS_LEGACY_SESSION_KEY = 'tas_active_session_v1';

window.tasReadSessionsMap = function () {
  let map = {};
  try { map = JSON.parse(localStorage.getItem(TAS_SESSIONS_KEY) || '{}') || {}; } catch (e) { map = {}; }
  // One-time migration from the old single-slot record.
  try {
    const legacy = JSON.parse(localStorage.getItem(TAS_LEGACY_SESSION_KEY) || 'null');
    if (legacy && legacy.role) {
      const k = (legacy.role === 'admin' ? 'admin:' : 'client:') + String(legacy.loginId || legacy.clientId || '').toUpperCase();
      if (!map[k]) map[k] = legacy;
      localStorage.removeItem(TAS_LEGACY_SESSION_KEY);
      localStorage.setItem(TAS_SESSIONS_KEY, JSON.stringify(map));
    }
  } catch (e) {}
  return map;
};

window.tasSessionKey = function (sess) {
  if (!sess || !sess.role) return null;
  const id = sess.role === 'admin' ? (sess.loginId || 'admin') : (sess.loginId || sess.clientId || '');
  return sess.role + ':' + String(id).toUpperCase();
};

// Remember a login for THIS device only (never uploaded to the cloud).
window.tasSaveSession = function (sess) {
  try {
    const map = window.tasReadSessionsMap();
    const k = window.tasSessionKey(sess);
    if (!k) return;
    map[k] = { ...sess, ts: Date.now() };
    localStorage.setItem(TAS_SESSIONS_KEY, JSON.stringify(map));
  } catch (e) {}
};

// Look up the remembered login for a specific ID (or the most recent
// one overall when called without arguments — used at app start).
window.tasLoadSession = function (key) {
  const map = window.tasReadSessionsMap();
  if (key) return map[key] || null;
  let best = null;
  Object.values(map).forEach(s => { if (s && (!best || (s.ts || 0) > (best.ts || 0))) best = s; });
  return best;
};

// Forget ONE login (logout) — other remembered IDs stay untouched.
window.tasClearSession = function (key) {
  try {
    if (key) {
      const map = window.tasReadSessionsMap();
      delete map[key];
      localStorage.setItem(TAS_SESSIONS_KEY, JSON.stringify(map));
    } else {
      localStorage.removeItem(TAS_SESSIONS_KEY);
      localStorage.removeItem(TAS_LEGACY_SESSION_KEY);
    }
  } catch (e) {}
  try { sessionStorage.removeItem('tas_trainer_session'); } catch (e) {}
};

window.clearStatus = function (el) {
  if (el) { el.textContent = ''; el.className = 'status-msg'; }
};

window.setCloudStatus = function (online) {
  const el = $('cloudStatus'); if (!el) return;
  el.classList.toggle('online', online);
  const t = $('cloudStatusText');
  if (t) t.textContent = online ? '☁️ Connected' : '⚠️ Offline';
};

/* ============================================================
   THEME ENGINE — automatic light/dark based on SUNRISE & SUNSET
   ------------------------------------------------------------
   AUTO ONLY (by design): the manual Light/Dark toggle button was
   removed because the theme should always follow the sun:
     🌙 dark between sunset and sunrise,
     ☀️ light between sunrise and sunset.
   Any legacy 'tas_theme_mode' manual override saved by older
   versions is cleared on load so it can never stick.

   Sunrise/sunset are computed locally with a NOAA solar-position
   algorithm (no external API needed) using the browser geolocation
   when available. If the user denies location, we fall back to a
   sensible default: Dubai (25.2°N, 55.3°E).

   A timer re-checks every minute so the page flips exactly at the
   sun event without a reload.
   ============================================================ */

// --- NOAA sunrise/sunset calculation (accurate to ~1 minute) ---
window.computeSunTimes = function (date, lat, lon) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  // Day of year (UTC-based is fine for our purposes)
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  const zen = 90.833 * rad; // official zenith incl. refraction + sun radius
  const calc = (isRise) => {
    const lngHour = lon / 15;
    const t = isRise
      ? dayOfYear + ((6 - lngHour) / 24)
      : dayOfYear + ((18 - lngHour) / 24);
    // Sun's mean anomaly
    const M = (0.9856 * t) - 3.289;
    // Sun's true longitude
    let L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 283.0;
    L = ((L % 360) + 360) % 360;
    // Sun's right ascension
    let RA = (deg * Math.atan(0.91764 * Math.tan(L * rad)));
    RA = ((RA % 360) + 360) % 360;
    RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
    RA /= 15;
    // Local sidereal time at Greenwich
    const T = 6.656 + 0.06571 * t + 1.0027 * lngHour;
    // Sun's local hour angle
    let H = (T - RA) * 15;
    H = ((H + 180) % 360 + 360) % 360 - 180;
    const cosH = (Math.cos(zen * rad) - Math.sin(lat * rad) * Math.sin(L * rad)) /
                 (Math.cos(lat * rad) * Math.cos(L * rad));
    if (cosH > 1 || cosH < -1) return null; // sun never rises/sets (polar)
    H = deg * Math.acos(isRise ? Math.cos(((360 - H) * rad)) : H * rad) / 15;
    // Adjust for longitude and fix rounding
    let ut = H + lngHour;
    ut = ((ut % 24) + 24) % 24;
    return ut; // hours UTC
  };
  const build = (utHours) => {
    if (utHours == null) return null;
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    d.setUTCHours(Math.floor(utHours), Math.round((utHours % 1) * 60), 0, 0);
    return d;
  };
  return { sunrise: build(calc(true)), sunset: build(calc(false)) };
};

// --- Decide which theme should be active right now ---
window.isDarkBySun = function (now, lat, lon) {
  const times = window.computeSunTimes(now, lat, lon);
  if (!times.sunrise || !times.sunset) {
    // Polar edge cases — fall back to clock heuristic (18:00–06:00 dark)
    const h = now.getHours();
    return h >= 18 || h < 6;
  }
  // Compare in LOCAL wall-clock time. computeSunTimes returns UTC Date
  // objects; local hours = UTC sun-hours + the browser's timezone offset.
  // (Using raw UTC hours made the theme flip ~4h early/late outside the
  // Dubai fallback longitude — this fixes auto mode worldwide.)
  const off = -now.getTimezoneOffset() / 60;
  const srH = (times.sunrise.getUTCHours() + times.sunrise.getUTCMinutes() / 60 + off + 24) % 24;
  const ssH = (times.sunset.getUTCHours()  + times.sunset.getUTCMinutes()  / 60 + off + 24) % 24;
  const cur = now.getHours() + now.getMinutes() / 60;
  // Dark from sunset until sunrise (handles crossing midnight)
  return ssH <= srH ? (cur >= ssH || cur < srH) : (cur >= ssH && cur < srH);
};

window.getCurrentLocation = function () {
  return new Promise((resolve) => {
    try {
      const cached = JSON.parse(localStorage.getItem('tas_geo') || 'null');
      if (cached && Date.now() - cached.ts < 12 * 3600 * 1000) {
        return resolve({ lat: cached.lat, lon: cached.lon });
      }
    } catch (e) {}
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const g = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        try { localStorage.setItem('tas_geo', JSON.stringify({ ...g, ts: Date.now() })); } catch (e) {}
        resolve(g);
      },
      () => resolve(null),
      { timeout: 6000, maximumAge: 6 * 3600 * 1000 }
    );
  });
};

let _sunWatchTimer = null;
let _themeFirstApply = false;
let _sunGeoRequested = false;
let _sunGeo = { lat: 25.2, lon: 55.3 }; // fallback: Dubai (site locale)

window.applyAutoTheme = async function () {
  // AUTO ONLY: the manual Light/Dark toggle button was removed — the theme
  // always follows the local sunrise & sunset. Any legacy 'tas_theme_mode'
  // override saved by older versions is cleared so it can never stick.
  try { localStorage.removeItem('tas_theme_mode'); } catch (e) {}
  let theme;
  {
    if (!_sunGeoRequested) {
      _sunGeoRequested = true;
      const geo = await window.getCurrentLocation();
      if (geo) _sunGeo = geo;
    }
    theme = window.isDarkBySun(new Date(), _sunGeo.lat, _sunGeo.lon) ? 'dark' : 'light';
  }
  const prev = document.documentElement.getAttribute('data-theme');
  // Only touch the attribute when it actually changes — avoids needless
  // repaints every minute while the sun state is stable.
  const changed = (prev || 'light') !== theme;
  if (changed) {
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }
  // Enable the smooth cross-fade CSS (html.theme-anim) after first paint
  if (!_themeFirstApply) { _themeFirstApply = true; setTimeout(() => document.documentElement.classList.add('theme-anim'), 120); }
  // Toast only when the auto engine actually flipped the theme
  if (changed && prev && typeof window.showToast === 'function') {
    window.showToast(theme === 'dark' ? '🌙 Sunset — switched to dark mode' : '☀️ Sunrise — switched to light mode', 'info', 2500);
  }
  return theme;
};

/* initThemeToggle: kept as a name for backward compatibility (main.js calls
   it on startup), but there is NO manual button any more — this simply starts
   the automatic sunrise/sunset engine: apply now, re-check every minute so the
   flip happens live at dawn/dusk, and re-check whenever the tab regains focus. */
window.initThemeToggle = function () {
  window.applyAutoTheme();
  if (!_sunWatchTimer) _sunWatchTimer = setInterval(() => window.applyAutoTheme(), 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) window.applyAutoTheme();
  });
};

window.getMonthName = (i) =>
  ['January','February','March','April','May','June','July','August','September','October','November','December'][i];

window.formatClassTime12 = function (t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h, 10);
  const ap = hr >= 12 ? 'PM' : 'AM';
  return `${hr % 12 || 12}:${m} ${ap}`;
};

window.formatTime12 = (iso) => iso
  ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  : '';

window.formatDateReadable = (y, m, d) =>
  new Date(y, m, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

window.formatDateISO = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

window.getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();