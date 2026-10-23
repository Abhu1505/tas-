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
    // If the OS asks for reduced motion, don't tag the page at all —
    // every .js-anim-guarded rule (reveals, cascades, shine…) stays off.
    if (reduced) { try { document.documentElement.classList.remove('js-anim'); } catch (e2) {} }
  } catch (e) {}

  // 🛡️ KILL SWITCH: if ANY other script on the page throws an uncaught
  // error during load (which is exactly how the animations kept silently
  // dying before), remove html.js-anim immediately. That makes every
  // reveal/cascade rule inert so content can never get stuck invisible.
  // The pure-CSS aurora orbs in #bgWatermark are NOT affected by this —
  // they animate regardless of any JavaScript failure.
  try {
    window.addEventListener('error', function () {
      try { document.documentElement.classList.remove('js-anim'); } catch (e) {}
    });
  } catch (e) {}

  // 🍏 Apple-style motion is "scroll-driven" — on apple.com the page must
  // actually scroll for sections to reveal. This portal is a dashboard app
  // where everything fits one screen, so we add an auto-scroll nudge after
  // login: the window glides down ~70% of a viewport and back up within
  // ~1.6s. That single gesture triggers every scroll reveal + KPI roll-up
  // at once, exactly like landing on an Apple product page. Users who have
  // already scrolled themselves (or use keyboards/touch mid-load) are left
  // alone; reduced-motion users never see it.
  var userScrolled = false;
  try {
    window.addEventListener('wheel', function () { userScrolled = true; }, { passive: true, once: true });
    window.addEventListener('touchstart', function () { userScrolled = true; }, { passive: true, once: true });
    window.addEventListener('keydown', function (e) {
      if (/^(Page|Arrow|Home|End|)/.test(e.key)) userScrolled = true;
    }, { passive: true, once: true });
  } catch (e) {}

  function appleIntroScroll() {
    if (reduced || userScrolled) return;
    if ((window.scrollY || document.documentElement.scrollTop || 0) > 8) return;
    var d = document.documentElement;
    var canScroll = (d.scrollHeight - window.innerHeight) > 120;
    if (!canScroll) return;
    try {
      var dist = Math.round(window.innerHeight * 0.7);
      window.scrollTo({ top: dist, behavior: 'smooth' });
      setTimeout(function () {
        if (userScrolled) return;               // don't yank back if they took over
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 950);
    } catch (e) {}
  }

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

  // ---- 🍏 Tab "rep" flourish (Apple-style micro-motion) ---------------
  // Wrap a tab button's text in a span so the active label can do one
  // tiny hop when it becomes active — like Apple's nav pills settling.
  function ensureTabLabels() {
    try {
      document.querySelectorAll('.tab-btn').forEach(function (b) {
        if (b.querySelector('.tab-label')) return;
        var hasElement = false;
        for (var n = b.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 1) { hasElement = true; }   // e.g. badge span
        }
        if (hasElement) return;                          // leave badges alone
        var txt = b.textContent;
        b.textContent = '';
        var s = document.createElement('span');
        s.className = 'tab-label';
        s.textContent = txt;
        b.appendChild(s);
      });
    } catch (e) {}
  }
  // Re-run after every click/render batch: cheap and idempotent, picks
  // up tab bars that the app injects later (client detail, approvals…).
  function scheduleTabLabels() { setTimeout(ensureTabLabels, 320); }

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

  // ---- 🍏 Apple-style scroll reveals -----------------------------------
  // Sections drift up + defrost as they enter the viewport — the same
  // motion apple.com uses between product blocks, applied to THIS app's
  // real content: footer columns, dashboards, tab panels, workspace
  // blocks, cards, stat tiles, KPI tiles, schedule rows, plan/history/
  // session items… Newly rendered lists get picked up automatically by
  // the pop-observer below (it calls revealScan).
  var REVEAL_SELECTOR = [
    '.footer-top > *', '.footer-bottom',
    '#loginCard .login-head', '#loginCard .subhead', '#loginCard .input-group',
    '#loginCard .btn-primary', '#loginCard .admin-contact',
    '.dash-card .client-upcoming-card', '.dash-card .howto-card',
    '.tab-content > .section-card', '.admin-workspace > .section-card',
    '.settings-panel', '.danger-panel', '.reminder-section', '.credentials-box',
    '.stat-tile', '.home-stat', '.kpi-tile', '.motivation-card',
    '.client-item', '.history-item', '.session-card', '.plan-card',
    '.library-row', '.exercise-item', '.notif-item', '.reminder-item',
    '.class-time-row', '.contact-item', '.client-upcoming-item',
    '.calc-result-card', '.tools-card', '.report-card'
  ].join(',');
  var revealIO = null;
  function ensureRevealObserver() {
    if (revealIO || typeof IntersectionObserver === 'undefined') return;
    try {
      revealIO = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) continue;
          var el = entries[i].target;
          revealIO.unobserve(el);
          el.classList.add('reveal-in');
          setTimeout(function (e) { return function () { e.classList.remove('reveal', 'reveal-in'); }; }(el), 950);
        }
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
    } catch (e) { revealIO = null; }
  }
  function revealScan(root) {
    if (reduced) return;                       // no hidden states when motion is off
    try {
      ensureRevealObserver();
      if (!revealIO) return;
      var scope = root && root.querySelectorAll ? root : document;
      var list = scope.querySelectorAll(REVEAL_SELECTOR);
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (el.classList.contains('reveal') || el.classList.contains('hidden')) continue;
        if (el.closest && el.closest('.modal-overlay')) continue;   // modals keep their spring fx
        el.classList.add('reveal');
        revealIO.observe(el);
      }
    } catch (e) {}
  }

  // ---- 🍏 Weight-drop micro-bounce on approve/check taps ---------------
  // Tapping ✅ Approve / ✔ makes its leading icon drop & settle like a
  // plate being racked — training-flavoured feedback, Apple-level polish.
  document.addEventListener('click', function (e) {
    try {
      if (reduced) return;
      var btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!btn) return;
      if (!/approve|✔|✅/.test(btn.textContent || '')) return;
      var first = btn.firstChild;
      if (!first || first.nodeType !== 3) return;   // text node holding the emoji
      var m = first.nodeValue.match(/^\s*(\S)/);
      if (!m) return;
      var span = document.createElement('span');
      span.className = 'weight-drop';
      span.textContent = m[1];
      first.nodeValue = first.nodeValue.slice(m[1].length);
      btn.insertBefore(span, first.nextSibling ? first.nextSibling : null);
      span.addEventListener('animationend', function () {
        try {
          first.nodeValue = span.textContent + first.nodeValue;
          btn.removeChild(span);
        } catch (err) {}
      });
    } catch (err) { /* cosmetics never break clicks */ }
  }, true);

  // ---- Chart lines draw themselves in (Apple spec-chart style) ---------
  // Measure each polyline once so stroke-dasharray matches its true length.
  function measureChartLines(root) {
    try {
      var scope = root && root.querySelectorAll ? root : document;
      scope.querySelectorAll('.chart-svg polyline').forEach(function (p) {
        if (p.style.getPropertyValue('--len')) return;
        try { p.style.setProperty('--len', Math.ceil(p.getTotalLength()) + 2); } catch (e) {}
      });
    } catch (e) {}
  }

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
      scheduleTabLabels();              // tab bars inside may be fresh DOM
      measureChartLines(el);            // charts rendered earlier: prep line lengths
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
    // 🛡️ BLINK FIX: 'clientStatGrid' removed — the client stat tiles are
    // re-rendered by the 60s notification poll and every realtime sync, so
    // popping the whole grid made the ✅/💵 tiles visibly blink several times
    // a minute. The individual numbers still roll-up nicely via counters.js.
    'homeStatsRow', 'clientListContainer', 'approvalsList',
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
        // Fresh DOM just landed: register scroll-reveals + measure charts
        // inside it, and pick up any tab buttons rendered with it.
        revealScan(el);
        measureChartLines(el);
        scheduleTabLabels();
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

  // ---- Screen-change hook -------------------------------------------
  // The app switches screens by calling window.transitionToCard() (see
  // js/auth.js). After the new screen has run its entry animation, fire
  // the Apple-style intro scroll so every below-the-fold section reveals
  // itself on screen — the moment users said felt "missing" vs apple.com.
  function wrapTransitionToCard() {
    try {
      if (typeof window.transitionToCard !== 'function' || window.transitionToCard.__animWrapped) return;
      var orig = window.transitionToCard;
      var wrapped = function () {
        var r = orig.apply(this, arguments);
        setTimeout(appleIntroScroll, 650);   // let dashIn/loginPop play first
        return r;
      };
      wrapped.__animWrapped = true;
      window.transitionToCard = wrapped;
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      startObserver(); startPopObserver(); ensureIndicators();
      ensureTabLabels(); revealScan(document); measureChartLines(document);
      wrapTransitionToCard();
    });
  } else {
    startObserver(); startPopObserver();
    ensureTabLabels(); revealScan(document); measureChartLines(document);
    wrapTransitionToCard();
  }
  // auth.js may define transitionToCard slightly later depending on
  // parse order — retry once more after full load, then again late.
  window.addEventListener('load', wrapTransitionToCard);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureIndicators);
  } else {
    ensureIndicators();
  }
  setTimeout(function () {
    ensureIndicators();
    ensureTabLabels(); revealScan(document); measureChartLines(document);
  }, 600); // late-rendered dashboards
})();
