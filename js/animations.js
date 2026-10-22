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
//   • SITE-WIDE reveal tracking — a MutationObserver watches the
//     .hidden class on every screen-like container (dashboards,
//     login card, settings/approvals/library/reports/class-times
//     panels, client detail panel, modals, workspaces and tab
//     contents). Whenever one becomes visible it gets a temporary
//     .anim-in tag, which triggers its entry animation AND makes
//     freshly rendered lists inside it (client rows, history
//     items, session cards, stat tiles…) cascade in one by one.
//   • Late-rendered data (after async loads) pops in via .anim-pop.
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

  // ---- Site-wide reveal tracking (MutationObserver) -----------------
  // Every "screen-like" container in the app is shown/hidden by
  // toggling the .hidden class. We watch those class changes and tag
  // a freshly-revealed container with .anim-in for ~1s. The CSS then:
  //   • plays that container's entry animation (panel drop, modal
  //     spring, dashboard rise, login pop…), and
  //   • cascades the repeated children inside it (client rows,
  //     history items, session cards, stat tiles…) one after another.
  var SCREEN_SELECTOR = [
    '.dash-card', '#loginCard', '.login-card', '.modal-overlay', '.settings-panel',
    '.client-detail-panel', '.admin-workspace', '.tab-content'
  ].join(',');

  function markRevealed(el) {
    if (!el || reduced) return;
    try {
      el.classList.remove('anim-in');
      void el.offsetWidth;              // restart the CSS animation
      el.classList.add('anim-in');
      setTimeout(function () { el.classList.remove('anim-in'); }, 1000);
    } catch (e) {}
  }

  function handleHiddenFlip(m) {
    try {
      var el = m.target;
      if (!el.classList || typeof el.matches !== 'function') return;
      if (!el.matches(SCREEN_SELECTOR)) return;
      var nowHidden = el.classList.contains('hidden');
      var wasHidden = (m.oldValue || '').indexOf('hidden') !== -1;
      if (!nowHidden && wasHidden) markRevealed(el);   // hidden → visible
    } catch (e) {}
  }

  function startObserver() {
    try {
      if (typeof MutationObserver === 'undefined') return;
      var mo = new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) handleHiddenFlip(list[i]);
      });
      mo.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true,
        subtree: true
      });
    } catch (e) {}
  }

  // ---- Pop-in for late-rendered data --------------------------------
  // When async loads finish (dashboard stats, client lists, reports),
  // their containers are already visible, so no .anim-in fires. Watch
  // for element insertions into known data containers and give each
  // new batch a single soft pop (never per-item — avoids flicker on
  // frequent re-renders).
  var POP_TARGETS = [
    'homeStatsRow', 'clientStatGrid', 'clientListContainer', 'approvalsList',
    'libraryList', 'assignList', 'clientHistoryList', 'clientPlanList',
    'clientProgressList', 'adminProgressList', 'clientUpcomingList',
    'clientInsightKpis', 'reportsPanel', 'monthSummaryContent',
    'insightSummary', 'progressDashboardContainer',
    // Additional live-data containers so every async render animates.
    'notifList', 'notificationList', 'reminderPreview', 'sessionList',
    'classTimesList', 'contactList', 'toolsResults', 'rpReportArea',
    'exerciseList', 'dashboardClients', 'weeklyChart', 'caloriesResult',
    'bmrResult', 'bodyfatResult'
  ];
  var popTimers = {};
  function schedulePop(id) {
    if (reduced || popTimers[id]) return;
    popTimers[id] = setTimeout(function () {
      popTimers[id] = null;
      try {
        var el = document.getElementById(id);
        if (!el || el.classList.contains('hidden')) return;
        el.classList.remove('anim-pop');
        void el.offsetWidth;
        el.classList.add('anim-pop');
        setTimeout(function () { el.classList.remove('anim-pop'); }, 700);
      } catch (e) {}
    }, 60);
  }

  function startPopObserver() {
    try {
      if (typeof MutationObserver === 'undefined') return;
      var mo = new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var added = list[i].addedNodes;
          if (!added || !added.length) continue;
          var parent = list[i].target;
          // walk up to find which watched container this belongs to
          for (var node = parent; node; node = node.parentNode) {
            if (node.id && POP_TARGETS.indexOf(node.id) !== -1) { schedulePop(node.id); break; }
            if (node === document.body) break;
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      startObserver(); startPopObserver(); ensureIndicators();
    });
  } else {
    startObserver(); startPopObserver();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureIndicators);
  } else {
    ensureIndicators();
  }
  setTimeout(ensureIndicators, 600); // late-rendered dashboards
})();
