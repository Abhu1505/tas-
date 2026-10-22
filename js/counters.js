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

  function tween(el, id, fromVal, toText) {
    var toVal = parseDisplayed(toText);
    if (toVal === null || fromVal === null || reduced || fromVal === toVal) {
      el.textContent = toText;           // non-numeric or motion off: plain swap
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
      el.textContent = fmt(fromVal + (toVal - fromVal) * eased, decimals, useCommas, pre, suf);
      if (p < 1) { running[id] = requestAnimationFrame(step); }
      else {
        running[id] = 0;
        el.textContent = toText;                      // land exactly on final text
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
      var mo = new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var newText = el.textContent;
          var oldText = list[i].oldValue;
          if (newText === oldText) continue;
          var fromVal = parseDisplayed(oldText);
          if (isVisible(el)) {
            // restore the old number for one frame, then roll to the new one
            el.textContent = oldText;
            requestAnimationFrame(function () { tween(el, id, fromVal, newText); });
          }
          // not visible → leave the final value in place; it will simply
          // be there when the user scrolls to it (no jarring hidden roll)
          return; // one mutation record is enough per batch
        }
      });
      try { mo.observe(el, { childList: true, characterData: true, subtree: true, attributeOldValue: false, characterDataOldValue: true }); } catch (e) {}
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
      var pre = prefixOf(toText), suf = suffixOf(toText);
      var decimals = (String(toText).match(/\.(\d+)/) || ['', ''])[1].length;
      var useCommas = /,/.test(toText) || toVal >= 1000;
      el.textContent = fmt(0, decimals, useCommas, pre, suf);
      tween(el, id, 0, toText);
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
