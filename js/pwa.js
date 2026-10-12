// ============================================================
// 📲 PWA — service-worker registration + install prompt
// ------------------------------------------------------------
// • Registers /sw.js (network-first app shell → offline support).
// • When a new SW is waiting, it activates immediately and lets
//   js/update-site.js handle the user-facing reload flow.
// • Captures `beforeinstallprompt` so an "Install app" chip can
//   appear in the login card on supporting browsers.
// ============================================================
(function () {
  'use strict';

  /* ---- Layout sanity check (auto-adjust safety net) ----
     If anything is ever wider than the viewport, tag <html> so CSS can
     clamp it, and re-run the check after resizes/rotations. This makes
     sure content always fits the screen on phones AND laptops. */
  function layoutGuard() {
    var doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) doc.classList.add('layout-overflow');
    else doc.classList.remove('layout-overflow');
  }
  window.addEventListener('resize', layoutGuard, { passive: true });
  window.addEventListener('orientationchange', function () { setTimeout(layoutGuard, 300); }, { passive: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', layoutGuard);
  } else {
    layoutGuard();
  }

  if (!('serviceWorker' in navigator)) return;
  // file:// has no SW support and would only log errors.
  if (location.protocol !== 'https:' && !/^localhost$|^127\.|\[::1\]/.test(location.hostname)) return;

  function registerSW() {
    const scope = location.pathname.replace(/\/[^/]*$/, '/'); // folder containing index.html
    const swUrl = (scope.endsWith('/') ? scope : scope + '/') + 'sw.js';
    navigator.serviceWorker.register(swUrl, { scope: scope })
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            // A fresh deploy's SW is ready — hand over control silently.
            // update-site.js already offers the visible "🔄 Update Site" button.
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              try { nw.postMessage('SKIP_WAITING'); } catch (e) {}
            }
          });
        });
      })
      .catch(() => { /* offline / unsupported — the app keeps working normally */ });
  }

  if ('requestIdleCallback' in window) requestIdleCallback(registerSW, { timeout: 4000 });
  else window.addEventListener('load', registerSW, { once: true });

  /* ---- Install chip on the login card ---- */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallChip(true);
  });

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isAndroid() { return /Android/i.test(navigator.userAgent); }
  function inStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  /* Small "how to install" popover for browsers that don't fire
     beforeinstallprompt (iOS Safari, some Android setups). */
  function showHelpPopover() {
    if (document.getElementById('pwaHelpPop')) return;
    const ios = isIOS();
    const chromeAndroid = isAndroid() && /Chrome/.test(navigator.userAgent);
    const pop = document.createElement('div');
    pop.id = 'pwaHelpPop';
    pop.className = 'pwa-help-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-label', 'How to install this app');
    pop.innerHTML =
      '<button class="pwa-help-close" type="button" aria-label="Close">✕</button>' +
      '<h4>📲 Add TAS Training to your home screen</h4><ol>' +
      (ios
        ? '<li>Tap the <em>Share</em> button <span aria-hidden="true">⬆︎</span> in the Safari toolbar.</li>' +
          '<li>Choose <em>Add to Home Screen</em>.</li>' +
          '<li>Tap <em>Add</em> — TAS opens full-screen like an app.</li>'
        : chromeAndroid
          ? '<li>Open Chrome\'s menu (<em>⋮</em> at the top right).</li>' +
            '<li>Tap <em>Install app</em> or <em>Add to Home screen</em>.</li>' +
            '<li>Confirm — the portal gets its own icon and opens full-screen.</li>'
          : '<li>Open your browser menu (<em>⋮</em> or the three-dot icon).</li>' +
            '<li>Look for <em>Install app</em> or <em>Add to Home screen</em>.</li>' +
            '<li>If you don\'t see it, open the page in <em>Chrome</em> (Android) or <em>Safari</em> (iPhone), then try again.</li>') +
      '</ol>';
    document.body.appendChild(pop);
    pop.querySelector('.pwa-help-close').addEventListener('click', () => pop.remove());
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { pop.remove(); document.removeEventListener('keydown', esc); }
    });
  }

  function showInstallChip(auto) {
    if (inStandalone()) return;
    if (document.getElementById('pwaInstallBtn')) return;
    const card = document.getElementById('loginCard');
    if (!card) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'pwaInstallBtn';
    btn.className = 'btn-secondary btn-small pwa-install-btn';
    btn.title = 'Add this portal to your home screen for one-tap access';
    btn.innerHTML = '📲 Install app';
    btn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
        if (choice.outcome === 'accepted') btn.remove();
        deferredPrompt = null;
      } else {
        showHelpPopover(); // iOS Safari / unsupported browsers: guided steps
      }
    });
    const status = document.getElementById('unifiedStatus');
    card.insertBefore(btn, status || null);
    // On phones, surface the hint automatically once per session.
    if (auto && !deferredPrompt && (isIOS() || isAndroid())) {
      try {
        if (!sessionStorage.getItem('tas_install_hint_shown')) {
          sessionStorage.setItem('tas_install_hint_shown', '1');
          setTimeout(showHelpPopover, 900);
        }
      } catch (e) {}
    }
  }

  window.addEventListener('appinstalled', () => {
    const b = document.getElementById('pwaInstallBtn');
    if (b) b.remove();
    const p = document.getElementById('pwaHelpPop');
    if (p) p.remove();
    if (typeof showToast === 'function') showToast('✅ TAS Training installed to your device.', 'success');
  });

  // Show the chip for everyone on phones (native prompt where supported,
  // guided "Add to Home Screen" steps on iOS Safari).
  if (!inStandalone() && (isIOS() || isAndroid() || window.matchMedia('(max-width:700px)').matches)) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => showInstallChip(true));
    } else {
      showInstallChip(true);
    }
  }

  /* ---- Installed-app top-clipping fix ----
     In the installed PWA/WebView app the page can open slightly scrolled
     down (status bar / notch overlap + keyboard restore), so the top of the
     login card — brand logo row and heading — was unreadable. Whenever the
     login screen is showing in standalone mode, snap the view back to the
     very top so everything above the fold stays visible. Browser tabs are
     untouched. No sizes or content changed. */
  function keepAppTopVisible() {
    if (!inStandalone()) return;
    const login = document.getElementById('loginCard');
    if (login && !login.classList.contains('hidden')) {
      window.scrollTo(0, 0);
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', keepAppTopVisible);
  } else {
    keepAppTopVisible();
  }
  window.addEventListener('load', keepAppTopVisible);
  setTimeout(keepAppTopVisible, 350);   // after Drive photo / theme settle
  setInterval(keepAppTopVisible, 1500); // cheap no-op unless logged-out in app
})();
