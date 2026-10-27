// ============================================================
// 🔄 UPDATE SITE — deployment watcher (client + admin portal)
// ------------------------------------------------------------
// How it works:
//  • The release notes live in ONE place only: RELEASES below,
//    newest entry first. Each entry's fingerprint is computed
//    automatically from its text, so there is no version number
//    to keep in sync anywhere else in the codebase.
//  • This page itself is a fingerprint of the deployed version.
//    Every deploy changes index.html, so we hash the raw HTML
//    (no-store fetch) and compare it with the copy that produced
//    the currently-running page (saved in localStorage).
//  • On boot: if the saved fingerprint differs from what the
//    browser served us, an even NEWER deploy already happened →
//    show the popup immediately.
//  • Then we re-check every 60s while the tab is open. When a new
//    deployment is detected a notification toast pops up AND a
//    modal shows exactly WHAT has been updated (the release notes
//    for every version between the user's and the live one), with
//    the "🔄 Update Site" action inside the popup.
//  • Clicking the button stores the new fingerprint and does a
//    cache-busting reload, so the browser loads the latest
//    deployment. Until then the site keeps working on the old
//    (cached) page — nothing else breaks.
//  • The "🔄 Update Site" buttons are hidden by default; they only
//    ever appear via this script when an update is available.
//
// ➕ VERSION NAMING: versions start at "HA 0.3". The version name is ONLY
//    changed when the owner explicitly says so. Never bump it on your own.
//
// ➕ TO PUBLISH A NEW UPDATE (only after owner approves a new version name):
//    add ONE line at the TOP of RELEASES and set SITE_VERSION to its ver:
//      { ver: 'HA 0.4', date: 'DD Mon YYYY', title: 'Short headline', items: [
//        'What changed…', 'Another change…' ] },
//    Nothing else needs to be touched anywhere.
// ============================================================
(function () {
  'use strict';

  const KEY = 'tas_site_fingerprint_v1';
  const CHECK_MS = 60 * 1000; // poll once a minute
  let currentFp = null;       // fingerprint of the page actually running
  let updateReady = false;

  /* ---------- 📝 RELEASE NOTES — single source of truth ---------- */
  // ⚠️ VERSION POLICY: the version name changes ONLY when the owner says so.
  //    Current released version: HA 0.3. Do not bump it on your own.
  const SITE_VERSION = 'HA 0.3';
  const RELEASES = [
    {
      ver: 'HA 0.3',
      date: '03 Oct 2026',
      title: 'Client portal navigation fix',
      items: [
        'The tab bar in the client portal now stays fixed in one place — tabs no longer float around or become invisible while scrolling.'
      ]
    }
  ];
  // Fingerprint each release from its own text (stable across devices).
  RELEASES.forEach(r => { r.fp = 'rel-' + djb2(r.ver + '|' + r.date + '|' + r.title + '|' + r.items.join('|')); });

  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  // Releases strictly newer than `fp` (empty fp ⇒ everything known).
  function releasesSince(fp) {
    if (!fp) return RELEASES.slice();
    const idx = RELEASES.findIndex(r => r.fp === fp);
    return idx === -1 ? RELEASES.slice() : RELEASES.slice(0, idx);
  }

  async function hashText(str) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      // Fallback for non-secure contexts: simple djb2 hash.
      let h = 5381;
      for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
      return 'djb2-' + (h >>> 0).toString(16);
    }
  }

  async function fetchLiveFingerprint() {
    const url = location.pathname.split('?')[0].split('#')[0] + '?_up=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return hashText(await res.text());
  }

  /* ---------- UI ---------- */
  function showUpdateButton() {
    ['adminUpdateSiteBtn', 'clientUpdateSiteBtn'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.remove('hidden');
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Build the "what's new" HTML from the single RELEASES list.
  function whatsNewHtml(fp) {
    const rels = releasesSince(fp);
    if (!rels.length) {
      return '<div class="us-rel us-rel-generic"><p>A newer version of this site is live on the server. Press <strong>🔄 Update Site Now</strong> to load it.</p></div>';
    }
    return rels.map(r =>
      '<div class="us-rel">' +
        '<div class="us-rel-top">' +
          '<span class="us-rel-ver">' + esc(r.ver || SITE_VERSION) + '</span>' +
          '<span class="us-rel-date">📅 ' + esc(r.date) + '</span>' +
        '</div>' +
        '<div class="us-rel-title">' + esc(r.title) + '</div>' +
        '<ul class="us-rel-list">' + r.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>' +
      '</div>'
    ).join('');
  }

  function ensurePopup() {
    let p = document.getElementById('updateSitePopup');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'updateSitePopup';
    p.className = 'hidden';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-modal', 'true');
    p.setAttribute('aria-labelledby', 'uspTitle');
    p.innerHTML = `
      <div class="us-popup-box">
        <div class="usp-banner">
          <div class="usp-badge">NEW UPDATE</div>
          <div class="usp-icon">🚀</div>
          <h3 id="uspTitle">What's New on TAS</h3>
          <div class="usp-chip" id="uspVersionChip">${esc(SITE_VERSION)}</div>
        </div>
        <div class="usp-body">
          <div class="usp-section-label">Here's what has been updated</div>
          <div class="usp-notes" id="uspNotes"></div>
          <div class="usp-foot">You're still viewing the old cached page. Press
            <strong>🔄 Update Site Now</strong> to load the latest version instantly.</div>
        </div>
        <div class="usp-actions">
          <button class="btn-secondary btn-small" id="uspLaterBtn" type="button">⏳ Later</button>
          <button class="btn-update-site usp-update-btn" id="uspUpdateBtn" type="button">🔄 Update Site Now</button>
        </div>
      </div>`;
    document.body.appendChild(p);
    document.getElementById('uspLaterBtn').addEventListener('click', closePopup);
    document.getElementById('uspUpdateBtn').addEventListener('click', doUpdate);
    // Clicking the backdrop also dismisses (same as "Later").
    p.addEventListener('click', (e) => { if (e.target === p) closePopup(); });
    // Escape key closes the popup too.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !p.classList.contains('hidden')) closePopup();
    });
    return p;
  }

  function openPopup(notesFp) {
    const p = ensurePopup();
    document.getElementById('uspNotes').innerHTML = whatsNewHtml(notesFp);
    p.classList.remove('hidden');
    // Force a reflow so the entrance animation always plays, even when the
    // popup was already in the DOM.
    const box = p.querySelector('.us-popup-box');
    if (box && box.style) { box.style.animation = 'none'; void box.offsetWidth; box.style.animation = ''; }
    const btn = document.getElementById('uspUpdateBtn');
    if (btn) setTimeout(() => btn.focus(), 60);
  }

  function closePopup() {
    const p = document.getElementById('updateSitePopup');
    if (p) p.classList.add('hidden');
  }

  // The header buttons ALWAYS open the "What's New" popup first — the actual
  // reload only happens via the "🔄 Update Site Now" button inside the box.
  function openUpdatePopup() {
    let seenRel = null;
    try { seenRel = localStorage.getItem(KEY + '_rel'); } catch (e) {}
    // If we know a newer live fingerprint, prefer showing notes relative to it.
    openPopup(seenRel);
  }

  function doUpdate() {
    try {
      // Remember which release the user is moving to (for future "what's new").
      const last = RELEASES[0];
      if (last) localStorage.setItem(KEY + '_rel', last.fp);
      localStorage.setItem(KEY, currentFp || '');
    } catch (e) {}
    // Cache-busting reload so the browser must fetch the newest deployment.
    const base = location.href.split('#')[0];
    const clean = base.replace(/[?&]_r=[^&]*/, '');
    location.assign(clean + (clean.includes('?') ? '&' : '?') + '_r=' + Date.now());
  }

  function markUpdateAvailable(liveFp) {
    currentFp = liveFp;
    bindHeaderButtons();
    if (updateReady) return; // popup/toast already shown once this session
    updateReady = true;
    showUpdateButton();
    let seenRel = null;
    try { seenRel = localStorage.getItem(KEY + '_rel'); } catch (e) {}
    // Auto-open the "What's New" box popup so the user immediately sees
    // exactly what changed, plus the toast notification.
    openPopup(seenRel);
    if (typeof showToast === 'function') showToast('🆕 New site update available — see What\'s New and press 🔄 Update Site Now.', 'info', 8000);
  }

  // Bind the header buttons once (cheap safety — done on first check).
  function bindHeaderButtons() {
    ['adminUpdateSiteBtn', 'clientUpdateSiteBtn'].forEach(id => {
      const b = document.getElementById(id);
      if (b && !b.dataset.usBound) {
        b.dataset.usBound = '1';
        b.addEventListener('click', openUpdatePopup);
      }
    });
  }

  /* ---------- Always-visible version badge + "What's New" button ---------- */
  // Injected next to the portal title in the top bar, so SITE_VERSION is
  // visible on the live site at all times (not only inside the popup).
  // One place: reads SITE_VERSION constant above. Click opens the popup.
  function injectVersionBadge() {
    // One badge per dash-header (client + admin portals each get one).
    document.querySelectorAll('.dash-header').forEach(host => {
      if (host.querySelector('.us-version-badge')) return;
      const actions = host.querySelector('.dash-header-actions') || host;
      const wrap = document.createElement('span');
      wrap.className = 'us-version-badge';
      wrap.title = 'Current site version — click "What\'s New" to see updates';
      wrap.innerHTML = '<span class="usvb-ver">' + esc(SITE_VERSION) + '</span>' +
                       '<button class="usvb-btn" type="button">✨ What\'s New</button>';
      actions.insertBefore(wrap, actions.firstChild);
      const btn = wrap.querySelector('.usvb-btn');
      if (btn) btn.addEventListener('click', () => openPopup(null));
    });
  }

  /* ---------- detection ---------- */
  async function checkForUpdate(firstRun) {
    try {
      const liveFp = await fetchLiveFingerprint();
      const saved = localStorage.getItem(KEY);
      if (firstRun) {
        // Bind click handlers even before an update exists (cheap safety).
        bindHeaderButtons();
        if (saved && saved !== liveFp) {
          // The server already has something newer than the page we're running.
          markUpdateAvailable(liveFp);
        } else if (!saved) {
          try {
            localStorage.setItem(KEY, liveFp);
            // First visit on the current version: mark releases as seen so
            // the next deploy only shows genuinely new notes.
            const last = RELEASES[0];
            if (last) localStorage.setItem(KEY + '_rel', last.fp);
          } catch (e) {}
        }
        return;
      }
      if (liveFp !== (currentFp || saved || localStorage.getItem(KEY))) {
        markUpdateAvailable(liveFp);
      }
    } catch (e) { /* offline / file:// — silently keep working */ }
  }

  window.initUpdateSiteWatcher = function () {
    if (window.__usWatchInit) return;
    window.__usWatchInit = true;
    injectVersionBadge();
    checkForUpdate(true);
    setInterval(() => {
      if (!document.hidden && !updateReady) checkForUpdate(false);
    }, CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !updateReady) checkForUpdate(updateReady);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.initUpdateSiteWatcher());
  } else {
    window.initUpdateSiteWatcher();
  }
})();
