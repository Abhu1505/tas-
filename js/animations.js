// ============================================================
// SCREEN / TAB ANIMATION ENHANCER
// ------------------------------------------------------------
// The entry animations themselves live in css/styles.css and are
// pure CSS (they re-trigger automatically whenever a screen's
// .hidden class is removed). This small script only adds the
// "smart" layer on top:
//   • Direction-aware slides — moving to a tab on the RIGHT slides
//     the new screen in from the right, and vice versa (client
//     portal tabs, admin workspace tabs, client-detail tabs, the
//     create-client tabs and the approvals filter chips).
//   • A sliding pill indicator that glides behind the active tab
//     button in every .tabs-bar.
// Everything here is defensive: if any element is missing or an
// error occurs, the app keeps working with plain CSS behaviour.
// ============================================================
(function () {
  'use strict';

  // Enable the staggered card entrance rules (guarded by .js-anim so
  // content is never hidden when JavaScript is unavailable).
  try { document.documentElement.classList.add('js-anim'); } catch (e) {}

  var reduced = false;
  try {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    if (mq.addEventListener) mq.addEventListener('change', function (e) { reduced = e.matches; });
    else if (mq.addListener) mq.addListener(function (e) { reduced = e.matches; });
  } catch (e) {}

  // ---- Tab groups ---------------------------------------------------
  // Each group: the buttons, the panel-id prefix and how to map a button
  // to its panel id. Switching to a tab further right → slide from right.
  var GROUPS = [
    { sel: '.tab-btn[data-ctab]',      prefix: 'ctab-',      key: 'ctab' },
    { sel: '.tab-btn[data-atab2]',     prefix: null,         key: 'atab2',
      // Admin workspaces use fixed ids instead of the prefix pattern.
      panelFor: function (v) {
        return v === 'home' ? 'adminWorkspaceHome'
             : v === 'clients' ? 'adminWorkspaceClients'
             : v === 'calculators' ? 'adminWorkspaceCalculators' : null;
      } },
    { sel: '.tab-btn[data-tab]',       prefix: 'tab-',       key: 'tab' },
    { sel: '.tab-btn[data-ctabform]',  prefix: 'ctabform-',  key: 'ctabform' }
  ];

  function indexOfPanel(group, btn) {
    // Position of this button among its sibling tab buttons = panel order.
    var peers = document.querySelectorAll(group.sel);
    for (var i = 0; i < peers.length; i++) if (peers[i] === btn) return i;
    return -1;
  }

  function applyDirection(panelEl, fromIdx, toIdx) {
    if (!panelEl || reduced || fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    panelEl.classList.remove('slide-from-left', 'slide-from-right');
    panelEl.classList.add(toIdx > fromIdx ? 'slide-from-right' : 'slide-from-left');
    // Clean up the direction class once the animation finishes so the
    // next switch always starts fresh.
    setTimeout(function () {
      panelEl.classList.remove('slide-from-left', 'slide-from-right');
    }, 450);
  }

  // Remember which index was showing before each click, then animate the
  // newly-visible panel in the matching direction. Using a capture-phase
  // click listener means we observe the user's intent BEFORE the app's
  // own handlers toggle the .hidden classes.
  var lastVisible = {}; // group selector -> visible panel index

  document.addEventListener('click', function (e) {
    try {
      var btn = e.target && e.target.closest ? e.target.closest('.tab-btn') : null;
      if (!btn) return;
      for (var g = 0; g < GROUPS.length; g++) {
        var group = GROUPS[g];
        if (!btn.matches(group.sel)) continue;
        var targetId = group.panelFor ? group.panelFor(btn.dataset[group.key])
                                      : group.prefix + btn.dataset[group.key];
        var panelEl = targetId ? document.getElementById(targetId) : null;
        var fromIdx = (group.key in lastVisible) ? lastVisible[group.key] : -1;
        var toIdx = indexOfPanel(group, btn);
        // The app's handler runs after us and un-hides the panel; wait a
        // frame so the animation restarts cleanly on the now-visible node.
        requestAnimationFrame(function () {
          applyDirection(panelEl, fromIdx, toIdx);
          lastVisible[group.key] = toIdx;
        });
        break;
      }
    } catch (err) { /* never break navigation because of cosmetics */ }
  }, true);

  // Track the currently visible panel per group at all times (covers
  // programmatic switches like selectClient() resetting to the Message
  // tab, or deep-links clicking a tab button directly).
  function refreshVisibleIndex() {
    try {
      GROUPS.forEach(function (group) {
        var peers = document.querySelectorAll(group.sel);
        for (var i = 0; i < peers.length; i++) {
          if (!peers[i].classList.contains('active')) continue;
          var id = group.panelFor ? group.panelFor(peers[i].dataset[group.key])
                                  : group.prefix + peers[i].dataset[group.key];
          var el = id ? document.getElementById(id) : null;
          if (el && !el.classList.contains('hidden')) { lastVisible[group.key] = i; break; }
        }
      });
    } catch (e) {}
  }
  document.addEventListener('click', function () { setTimeout(refreshVisibleIndex, 80); });

  // ---- Sliding pill indicator ----------------------------------------
  // One white pill per .tabs-bar that glides under the active button.
  function moveIndicator(bar) {
    try {
      var ind = bar.querySelector('.tabs-indicator');
      var active = bar.querySelector('.tab-btn.active');
      if (!ind || !active) { if (ind) ind.style.opacity = '0'; return; }
      var br = bar.getBoundingClientRect(), ar = active.getBoundingClientRect();
      if (ar.width === 0) { ind.style.opacity = '0'; return; }
      var scrollLeft = bar.scrollLeft || 0;
      ind.style.opacity = '1';
      ind.style.width = ar.width + 'px';
      ind.style.transform = 'translateX(' + (ar.left - br.left + scrollLeft) + 'px)';
    } catch (e) {}
  }

  function ensureIndicators() {
    try {
      document.querySelectorAll('.tabs-bar').forEach(function (bar) {
        if (bar.querySelector('.tabs-indicator')) return;
        var d = document.createElement('div');
        d.className = 'tabs-indicator';
        d.setAttribute('aria-hidden', 'true');
        bar.insertBefore(d, bar.firstChild);
      });
      document.querySelectorAll('.tabs-bar').forEach(moveIndicator);
    } catch (e) {}
  }

  document.addEventListener('click', function () {
    setTimeout(ensureIndicators, 60);   // pick up bars rendered later
    document.querySelectorAll('.tabs-bar').forEach(function (bar) {
      if (bar.classList.contains('client-tabs')) return; // phone dock keeps per-button highlight
      // Re-measure after the app toggled .active classes.
      requestAnimationFrame(function () { moveIndicator(bar); });
      setTimeout(function () { moveIndicator(bar); }, 120);
    });
  });
  window.addEventListener('resize', function () {
    document.querySelectorAll('.tabs-bar').forEach(moveIndicator);
  }, { passive: true });
  document.addEventListener('scroll', function () {
    document.querySelectorAll('.tabs-bar').forEach(moveIndicator);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureIndicators);
  } else {
    ensureIndicators();
  }
  setTimeout(ensureIndicators, 600); // late-rendered dashboards
})();
