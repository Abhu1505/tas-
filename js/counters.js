// ============================================================
// 🍏 APPLE-STYLE NUMBER ROLL-UPS — wired to THIS site's content
// ------------------------------------------------------------
// apple.com rolls its headline numbers up from zero when they come
// into view. Here the same idea drives the training KPIs of the TAS
// portal, so every animated number means something real:
//   • Client dashboard : ✅ Sessions done · 💵 Amount due (AED)
//   • Admin Home       : 👥 Clients · ✅ Active · ⏳ Pending approvals
//                        📈 Sessions this month · 💵 Revenue this month
// Values are read from the DOM itself, so no render code had to be
// touched: whenever an app re-render drops a new number into one of
// these elements (auth.js, workspace.js …), we tween from the value
// that was on screen before to the new one. The roll only plays when
// the element is actually visible; off-screen counters snap silently
// and animate when they scroll into view (IntersectionObserver).
// Everything is defensive + honours prefers-reduced-motion.
// ============================================================
(function () {
  'use strict';

  var reduced = false;
  try {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    if (mq.addEventListener) mq.addEventListener('change', function (e) { reduced = e.matches; });
    else if (mq.addListener) mq.addListener(function (e) { reduced = e.matches; });
  } catch (e) {}

  // ---- The KPI elements worth rolling (all training/business stats) ----
  var TARGETS = [
    'clientDashDone', 'clientDashAmount',                                   // client stat tiles
    'hsTotalClients', 'hsActiveClients', 'hsPendingApprovals',              // admin home snapshot
    'hsMonthSessions', 'hsMonthRevenue'
  ];

  function parseDisplayed(txt) {
    // "12", "1,234", "AED 2,400" → numeric part; anything else → null.
    if (!txt) return null;
    var m = String(txt).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }
  function prefixOf(txt) {
    // "AED 2,400" → "AED " (everything before the first digit)
    var m = String(txt || '').match(/^(.*?)(?=\d)/);
    return m ? m[1] : '';
  }
  function suffixOf(txt) {
    // "AED 2,400" → "" · "12 kg" → " kg" (everything after the numeric run)
    var s = String(txt || '');
    var j = s.search(/\d/);
    if (j < 0) return '';
    var run = s.slice(j).match(/^[\d.,]+/);
    return run ? s.slice(j + run[0].length) : '';
  }
  function fmt(value, decimals, useCommas, pre, suf) {
    var out = decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
    if (useCommas) {
      var parts = out.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      out = parts.join('.');
    }
    return pre + out + suf;
  }

  var running = {};   // id -> active animation frame handle

  // 🛡️ BLINK FIX: while a roll-up is playing we write the intermediate
  // numbers ourselves. Those writes used to be picked up again by the
  // MutationObserver as "new" app renders, which restarted the tween and
  // rewound the number — a visible flicker on every poll/realtime sync.
  // Anything flagged as "silent" (our own animation frames, or re-writes
  // of an unchanged value) is ignored by the observer below.
  function silentSet(el, text) {
    el.__tasSilent = true;
    el.textContent = text;
    // Reset asynchronously so the MutationObserver callback (queued as a
    // microtask) still sees the flag when it runs for this mutation.
    setTimeout(function () { el.__tasSilent = false; }, 0);
  }

  function tween(el, id, fromVal, toText) {
    var toVal = parseDisplayed(toText);
    if (toVal === null || fromVal === null || reduced || fromVal === toVal) {
      silentSet(el, toText);             // non-numeric or motion off: plain swap
      return;
    }
    var pre = prefixOf(toText), suf = suffixOf(toText);
    var decimals = (String(toText).match(/\.(\d+)/) || ['', ''])[1].length;
    var useCommas = /,/.test(toText) || Math.abs(toVal) >= 1000;
    if (running[id]) { cancelAnimationFrame(running[id]); running[id] = 0; }
    var dur = Math.min(950, 420 + Math.abs(toVal - fromVal) * 6);
    var t0 = performance.now();
    el.classList.add('counting');
    function step(now) {
      var p = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);            // ease-out cubic, Apple-ish
      silentSet(el, fmt(fromVal + (toVal - fromVal) * eased, decimals, useCommas, pre, suf));
      if (p < 1) { running[id] = requestAnimationFrame(step); }
      else {
        running[id] = 0;
        silentSet(el, toText);                        // land exactly on final text
        setTimeout(function () { el.classList.remove('counting'); }, 500);
      }
    }
    running[id] = requestAnimationFrame(step);
  }

  // Watch each target for text changes made by the app's own render code.
  function observeTargets() {
    if (typeof MutationObserver === 'undefined') return;
    TARGETS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el.__tasCounted) return;
      el.__tasCounted = true;
      el.__tasLast = el.textContent;   // remember what is actually on screen
      var mo = new MutationObserver(function (list) {
        // 🛡️ BLINK FIX: our own animation writes are flagged — skip them.
        if (el.__tasSilent) return;
        for (var i = 0; i < list.length; i++) {
          var newText = el.textContent;
          var oldText = el.__tasLast;
          if (newText === oldText) continue;         // identical re-render → no roll
          var fromVal = parseDisplayed(oldText);
          var toVal = parseDisplayed(newText);
          el.__tasLast = newText;
          if (isVisible(el) && toVal !== null && fromVal !== null && fromVal !== toVal) {
            // Value genuinely changed while visible: roll from the number
            // that was on screen before to the new one — WITHOUT rewinding
            // the DOM first (the old "restore previous text" trick caused a
            // one-frame flash back to the stale value on every poll tick).
            tween(el, id, fromVal, newText);
          } else if (running[id]) {
            cancelAnimationFrame(running[id]); running[id] = 0;
            silentSet(el, newText);                  // off-screen or same value: snap
          }
          // not visible → leave the final value in place; it will simply
          // be there when the user scrolls to it (no jarring hidden roll)
          return; // one mutation record is enough per batch
        }
      });
      try { mo.observe(el, { childList: true, characterData: true, subtree: true }); } catch (e) {}
    });
  }

  function isVisible(el) {
    try {
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;         // display:none
      var vh = innerHeight || 800;
      return r.bottom > -20 && r.top < vh + 20;
    } catch (e) { return false; }
  }

  // First paint after login: dashboards appear with fresh numbers while
  // the MutationObserver has no "old" value yet — do one intro roll from
  // zero for the stat-tile/home-stat values currently on screen.
  function introRoll() {
    if (reduced) return;
    TARGETS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || !isVisible(el)) return;
      var toText = el.textContent;
      var toVal = parseDisplayed(toText);
      if (toVal === null || toVal === 0) return;
      // 🛡️ BLINK FIX: don't re-roll a number that has already rolled on
      // this screen — only animate when the value actually changed since
      // the last intro (prevents repeated zero-rewinds on tab clicks).
      if (el.__tasIntro === toText) return;
      el.__tasIntro = toText;
      el.__tasLast = String(toVal);   // observer sees "from" as the rolled start
      var pre = prefixOf(toText), suf = suffixOf(toText);
      var decimals = (String(toText).match(/\.(\d+)/) || ['', ''])[1].length;
      var useCommas = /,/.test(toText) || toVal >= 1000;
      silentSet(el, fmt(0, decimals, useCommas, pre, suf));
      tween(el, id, 0, toText);
      el.__tasLast = toText;
    });
  }

  function boot() {
    observeTargets();
    // Roll the numbers that just landed after login/dashboard reveal.
    setTimeout(introOncePerScreen, 120);
    // Dashboards can also be revealed later (auto-login, tab switches).
    document.addEventListener('click', function () { setTimeout(introOncePerScreen, 350); });
  }
  var lastIntroKey = '';
  function introOncePerScreen() {
    // Only re-roll when a different dashboard became visible.
    var key = '';
    ['loginCard', 'clientDashboard', 'adminDashboard'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) key += id;
    });
    if (!key || key === lastIntroKey) return;
    lastIntroKey = key;
    introRoll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
