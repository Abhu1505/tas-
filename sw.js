/* ============================================================
   TAS PERSONAL TRAINING — Service Worker (PWA)
   ------------------------------------------------------------
   Caching strategy (keeps the app offline-capable but NEVER
   stale after a deploy):
    • App shell (HTML/CSS/JS/icons/manifest) → network-first,
      cache fallback. When the network responds, the fresh copy
      is written back to the cache, so a later offline load uses
      the newest version.
    • Google Fonts → stale-while-revalidate (they are immutable).
    • Supabase API calls & Drive images → pass through untouched
      (data must always be live; auth headers are preserved).
   Version bump below forces a clean cache on the next deploy.
   ============================================================ */
'use strict';

const VERSION = 'tas-pwa-v34';
const SHELL_CACHE   = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

const PRECACHE = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './favicon-16.png', './favicon-32.png', './favicon-48.png',
  './js/config.js', './js/drive-images.js', './js/utils.js', './js/toast.js',
  './js/state.js', './js/exercise-library.js', './js/supabase-client.js',
  './js/realtime.js', './js/report.js', './js/contacts.js', './js/auth.js',
  './js/sessions.js', './js/exercises.js', './js/progress.js',
  './js/class-times.js', './js/approvals.js', './js/notifications.js',
  './js/reminders.js', './js/clients.js', './js/settings.js', './js/reports.js',
  './js/workspace.js', './js/calculators.js', './js/wipe.js', './js/update-site.js', './js/pwa.js',
  './js/client-portal.js', './js/tools.js',
  './vendor/jspdf.umd.min.js',
  './js/main.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      // 🛡️ Self-heal: if an OLD service worker ever cached the critical app
      // scripts without network-fresh headers, purge those exact entries so
      // the next load always fetches the fixed versions from the server.
      .then(() => caches.open(SHELL_CACHE))
      .then((c) => Promise.all([
        './js/main.js', './js/client-portal.js', './js/calculators.js',
        './vendor/jspdf.umd.min.js'
      ].map((u) => c.delete(u))))
      .then(() => self.clients.claim())
  );
});

function isPassthrough(url) {
  // Live data / third-party assets must never be intercepted by our caches.
  return url.hostname.includes('supabase.co') ||
         url.hostname.endsWith('googleapis.com') && url.pathname.includes('/storage/') ||
         url.hostname.includes('googleusercontent.com') ||
         url.hostname.includes('drive.google.com');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (isPassthrough(url)) return;

  // Cross-origin fonts: stale-while-revalidate in runtime cache.
  if (url.origin !== location.origin) {
    if (!url.hostname.includes('fonts.g')) return;
    e.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const net = fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // Same-origin app shell: network-first with cache fallback.
  e.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const cached = await cache.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await cache.match('./index.html') || await cache.match('./');
          if (shell) return shell;
          // Fully offline with no cached shell yet → show a friendly page
          // instead of the browser's error screen.
          return new Response(
            '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">' +
            '<title>TAS Training — offline</title></head>' +
            '<body style="font-family:system-ui,sans-serif;background:#eef4f9;color:#0e2231;display:flex;' +
            'align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem;">' +
            '<div style="max-width:420px;background:#fff;border-radius:16px;padding:2rem;text-align:center;' +
            'box-shadow:0 14px 34px rgba(14,34,49,.22);border-top:5px solid #1f4e3d;">' +
            '<h2 style="margin:0 0 .5rem;color:#1f4e3d;">📡 You\'re offline</h2>' +
            '<p style="margin:0 0 1rem;font-size:.95rem;line-height:1.5;">TAS Training needs a connection to ' +
            'load your latest sessions. Reconnect and pull down to refresh.</p>' +
            '<a href="./" style="display:inline-block;background:#1f4e3d;color:#fff;text-decoration:none;' +
            'padding:.7rem 1.4rem;border-radius:999px;font-weight:700;">Try again</a></div></body></html>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        throw err;
      }
    })()
  );
});

// Let js/pwa.js trigger an immediate refresh once a new SW is waiting.
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
