// ============================================================
// ⚡ TRAINING TOOLS — Workout Timer, Water Tracker & Motivation
// Fully client-side (localStorage per logged-in client). No cloud
// dependency, so it works offline inside the PWA.
// Mounted into the "⚡ Tools" tab of the client portal.
// ============================================================
(function (window) {
  'use strict';

  var LS_WATER = 'tas_water_v1';   // { clientId: { date:'YYYY-MM-DD', cups:n, goal:n } }
  var LS_TIMER = 'tas_timer_v1';   // { clientId: { work, rest, rounds } }

  function $(id) { return document.getElementById(id); }
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { }
  }
  function currentClientId() {
    var c = window.APP_STATE && window.APP_STATE.loggedInClient;
    return c ? String(c.id) : 'guest';
  }

  // ---------------- Audio beep (WebAudio, no asset files) ----------------
  var _actx = null;
  function beep(freq, durMs, vol) {
    if (!state.soundOn) return;
    try {
      if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
      if (_actx.state === 'suspended') _actx.resume();
      var osc = _actx.createOscillator(), gain = _actx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq || 880;
      gain.gain.setValueAtTime(vol || 0.15, _actx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _actx.currentTime + (durMs || 180) / 1000);
      osc.connect(gain); gain.connect(_actx.destination);
      osc.start(); osc.stop(_actx.currentTime + (durMs || 180) / 1000);
    } catch (e) { }
  }
  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { }
  }

  // ---------------- ⏱️ Interval timer ----------------
  var state = {
    work: 30, rest: 10, rounds: 8,
    phase: 'work',            // 'work' | 'rest'
    round: 1,
    remaining: 30,
    running: false,
    tickHandle: null,
    soundOn: true
  };

  function fmt(s) {
    s = Math.max(0, Math.round(s));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function renderTimer() {
    var disp = $('toolTimerDisplay'); if (!disp) return;
    disp.textContent = fmt(state.remaining);
    disp.classList.toggle('phase-work', state.phase === 'work');
    disp.classList.toggle('phase-rest', state.phase === 'rest');
    var total = state.phase === 'work' ? state.work : state.rest;
    var pct = total > 0 ? Math.min(100, ((total - state.remaining) / total) * 100) : 0;
    var fill = $('toolTimerFill');
    if (fill) { fill.style.width = pct.toFixed(1) + '%'; fill.className = 'timer-progress-fill ' + (state.phase === 'work' ? 'fill-work' : 'fill-rest'); }
    var rounds = $('toolTimerRounds');
    if (rounds) {
      rounds.textContent = state.running || state.remaining !== (state.phase === 'work' ? state.work : state.rest)
        ? 'Round ' + state.round + ' of ' + state.rounds + ' · ' + (state.phase === 'work' ? 'WORK 💪' : 'REST 😮‍💨')
        : 'Round 1 of ' + state.rounds + ' · Ready';
    }
    document.documentElement.classList.toggle('timer-running', state.running);
    var startBtn = $('toolTimerStartBtn'), pauseBtn = $('toolTimerPauseBtn');
    if (startBtn) startBtn.disabled = state.running;
    if (pauseBtn) pauseBtn.disabled = !state.running;
    // Live countdown in the browser tab title while running
    document.title = state.running
      ? fmt(state.remaining) + ' · ' + (state.phase === 'work' ? 'WORK' : 'REST') + ' — TAS'
      : 'TAS Personal Training — Client & Trainer Portal';
  }

  function stopTimer(done) {
    state.running = false;
    if (state.tickHandle) { clearInterval(state.tickHandle); state.tickHandle = null; }
    if (done) {
      state.phase = 'work'; state.round = 1; state.remaining = state.work;
      beep(660, 300, 0.2); buzz([200, 80, 200]);
      if (window.showToast) window.showToast('🎉 Workout complete! Great job.', 'success', 5000);
    }
    renderTimer();
  }

  function tick() {
    state.remaining -= 1;
    if (state.remaining <= 0) {
      if (state.phase === 'work') {
        if (state.round >= state.rounds) { stopTimer(true); return; }
        state.phase = 'rest'; state.remaining = state.rest;
        beep(440, 200); buzz(120);
      } else {
        state.phase = 'work'; state.round += 1; state.remaining = state.work;
        beep(880, 250); buzz([100, 60, 100]);
      }
    } else if (state.remaining === 3) {
      beep(700, 100, 0.1); // 3-2-1 warning
    }
    renderTimer();
  }

  function startTimer() {
    if (state.running) return;
    saveTimerPrefs();
    state.running = true;
    state.tickHandle = setInterval(tick, 1000);
    // Unlock audio on user gesture
    try { if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)(); if (_actx.state === 'suspended') _actx.resume(); } catch (e) { }
    renderTimer();
  }

  function loadTimerPrefs() {
    var all = readJson(LS_TIMER, {});
    var p = all[currentClientId()];
    if (p) {
      state.work = p.work || state.work; state.rest = p.rest || state.rest; state.rounds = p.rounds || state.rounds;
      var w = $('toolWorkSec'), r = $('toolRestSec'), rd = $('toolRounds');
      if (w) w.value = state.work; if (r) r.value = state.rest; if (rd) rd.value = state.rounds;
    }
    state.remaining = state.work;
    markActivePreset();
    renderTimer();
  }
  function saveTimerPrefs() {
    var all = readJson(LS_TIMER, {});
    all[currentClientId()] = { work: state.work, rest: state.rest, rounds: state.rounds };
    writeJson(LS_TIMER, all);
  }
  function applyInputs() {
    var w = $('toolWorkSec'), r = $('toolRestSec'), rd = $('toolRounds');
    state.work = Math.min(600, Math.max(5, parseInt(w && w.value, 10) || 30));
    state.rest = Math.min(600, Math.max(5, parseInt(r && r.value, 10) || 10));
    state.rounds = Math.min(99, Math.max(1, parseInt(rd && rd.value, 10) || 8));
    if (!state.running) { state.phase = 'work'; state.round = 1; state.remaining = state.work; }
    saveTimerPrefs();
    renderTimer();
  }
  function markActivePreset() {
    var key = state.work + '-' + state.rest + '-' + state.rounds;
    document.querySelectorAll('[data-timer-preset]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-timer-preset') === key);
    });
  }

  // ---------------- 💧 Water tracker ----------------
  function getWater() {
    var all = readJson(LS_WATER, {});
    var w = all[currentClientId()];
    var today = todayKey();
    if (!w || w.date !== today) w = { date: today, cups: 0, goal: (w && w.goal) || 8 };
    return w;
  }
  function setWater(w) {
    var all = readJson(LS_WATER, {});
    all[currentClientId()] = w;
    writeJson(LS_WATER, all);
  }
  function renderWater() {
    var wrap = $('toolWaterGlasses'); if (!wrap) return;
    var w = getWater();
    var count = $('toolWaterCount');
    if (count) count.textContent = w.cups + ' / ' + w.goal + ' glasses' + (w.cups >= w.goal ? ' 🎉 Goal reached!' : '');
    var label = $('toolWaterGoalLabel'); if (label) label.textContent = w.goal;
    wrap.innerHTML = '';
    for (var i = 1; i <= w.goal; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'water-glass' + (i <= w.cups ? ' filled' : '');
      b.textContent = i <= w.cups ? '💧' : '🥃';
      b.setAttribute('aria-label', 'Set intake to ' + i + ' glasses');
      (function (n) { b.addEventListener('click', function () { changeWater(n - getWater().cups); }); })(i);
      wrap.appendChild(b);
    }
    var fill = $('toolWaterFill');
    if (fill) fill.style.width = Math.min(100, (w.cups / Math.max(1, w.goal)) * 100).toFixed(1) + '%';
  }
  function changeWater(delta) {
    var w = getWater();
    var prev = w.cups;
    w.cups = Math.max(0, w.cups + delta);
    setWater(w);
    renderWater();
    if (prev < w.goal && w.cups >= w.goal) {
      beep(880, 200); buzz([80, 40, 80]);
      if (window.showToast) window.showToast('💧 Daily water goal reached — nicely done!', 'success');
    }
  }
  function cycleGoal() {
    var w = getWater();
    w.goal = w.goal >= 12 ? 6 : w.goal + 1;
    setWater(w);
    renderWater();
  }

  // ---------------- ✨ Motivation quotes ----------------
  var QUOTES = [
    '“The body achieves what the mind believes.” — Napoleon Hill',
    '“Push yourself, because no one else is going to do it for you.”',
    '“Small steps every day add up to big results.”',
    '“You don’t have to be extreme, just consistent.”',
    '“The pain you feel today will be the strength you feel tomorrow.”',
    '“Don’t count the days. Make the days count.” — Muhammad Ali',
    '“Sweat is just fat crying.”',
    '“Your only limit is you.”',
    '“Discipline beats motivation — show up anyway.”',
    '“A one-hour workout is 4% of your day. No excuses.”',
    '“Stronger than yesterday. That’s the only competition.”',
    '“Rest is part of the training, not a break from it.”'
  ];
  function dailyQuoteIndex() {
    return Math.abs(Math.floor(Date.now() / 86400000)) % QUOTES.length;
  }
  function showQuote(seed) {
    var el = $('toolQuoteText'); if (!el) return;
    var d = seed != null ? seed : dailyQuoteIndex(); // daily rotating
    el.textContent = QUOTES[Math.abs(d) % QUOTES.length];
    el.classList.remove('quote-pop'); void el.offsetWidth; el.classList.add('quote-pop');
  }

  // ---------------- ✨ Daily Motivation POPUP (once per day, on login) ----------
  // Shows right after a client opens their dashboard for the FIRST time in a
  // calendar day. "Let's do this" / ✕ marks today as shown (per client, in
  // localStorage); relogins or refreshes the same day never re-trigger it.
  var MOT_SHOWN_KEY = 'tas_motivation_shown_';   // + clientId → 'YYYY-MM-DD'
  var motOpen = false;

  function setMotQuote(idx) {
    var el = $('motQuoteText'); if (!el) return;
    el.textContent = QUOTES[Math.abs(idx) % QUOTES.length];
    el.classList.remove('quote-pop'); void el.offsetWidth; el.classList.add('quote-pop');
  }
  function openMotivationPopup() {
    var modal = $('motivationModal'); if (!modal) return;
    var dl = $('motDateLabel');
    if (dl) {
      try {
        dl.textContent = new Date().toLocaleDateString('en-GB',
          { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      } catch (e) { dl.textContent = todayKey(); }
    }
    setMotQuote(dailyQuoteIndex());
    modal.classList.remove('hidden');
    motOpen = true;
  }
  function markMotShownToday() {
    try { localStorage.setItem(MOT_SHOWN_KEY + currentClientId(), todayKey()); } catch (e) { }
  }
  window.closeMotivationPopup = function () {
    var modal = $('motivationModal');
    if (modal) modal.classList.add('hidden');
    motOpen = false;
    markMotShownToday();
  };
  // Called by auth.js right after a successful CLIENT login.
  window.checkDailyMotivationPopup = function () {
    var c = window.APP_STATE && window.APP_STATE.loggedInClient;
    if (!c) return;                                  // clients only
    if (motOpen) return;                             // already visible
    var lastShown = null;
    try { lastShown = localStorage.getItem(MOT_SHOWN_KEY + String(c.id)); } catch (e) { }
    if (lastShown === todayKey()) return;            // already shown today
    setTimeout(function () {                         // small beat so the
      var cc = window.APP_STATE && window.APP_STATE.loggedInClient;   // dashboard
      if (cc && String(cc.id) === String(c.id)) openMotivationPopup(); // settles first
    }, 900);
  };

  // ---------------- Wiring ----------------
  function bindOnce() {
    if (bindOnce.done) return; bindOnce.done = true;

    var startBtn = $('toolTimerStartBtn');
    if (startBtn) startBtn.addEventListener('click', startTimer);
    var pauseBtn = $('toolTimerPauseBtn');
    if (pauseBtn) pauseBtn.addEventListener('click', function () { stopTimer(false); });
    var resetBtn = $('toolTimerResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', function () { stopTimer(true); });
    ['toolWorkSec', 'toolRestSec', 'toolRounds'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', function () { markActivePreset(); applyInputs(); });
    });
    document.querySelectorAll('[data-timer-preset]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = (b.getAttribute('data-timer-preset') || '').split('-');
        if (p.length !== 3) return;
        stopTimer(true);
        state.work = +p[0]; state.rest = +p[1]; state.rounds = +p[2];
        var w = $('toolWorkSec'), r = $('toolRestSec'), rd = $('toolRounds');
        if (w) w.value = state.work; if (r) r.value = state.rest; if (rd) rd.value = state.rounds;
        markActivePreset(); applyInputs();
      });
    });
    var snd = $('toolSoundToggle');
    if (snd) snd.addEventListener('click', function () {
      state.soundOn = !state.soundOn;
      snd.setAttribute('aria-pressed', String(state.soundOn));
      snd.textContent = state.soundOn ? '🔊 Sound' : '🔇 Muted';
      snd.classList.toggle('active', state.soundOn);
    });

    var plus = $('toolWaterPlus'); if (plus) plus.addEventListener('click', function () { changeWater(1); });
    var minus = $('toolWaterMinus'); if (minus) minus.addEventListener('click', function () { changeWater(-1); });
    var goal = $('toolWaterGoalBtn'); if (goal) goal.addEventListener('click', cycleGoal);

    var qn = $('toolQuoteNext'); if (qn) qn.addEventListener('click', function () { showQuote(Math.floor(Math.random() * 1e6)); });

    // ✨ Daily motivation popup buttons (delegated-safe: markup ships static)
    var motNext = $('motNextBtn');
    if (motNext) motNext.addEventListener('click', function () {
      setMotQuote(Math.floor(Math.random() * 1e6));
    });
    var motStart = $('motStartBtn');
    if (motStart) motStart.addEventListener('click', function () {
      window.closeMotivationPopup();
      if (window.showToast) window.showToast('💪 Let’s make today count!', 'success');
    });
    var motX = $('motCloseX');
    if (motX) motX.addEventListener('click', function () { window.closeMotivationPopup(); });

    // Restore tab title when leaving the tools view / finishing
    window.addEventListener('beforeunload', function () { stopTimer(false); });
  }

  // Public refresh hook — called by client-portal after login/tab switch
  window.refreshTrainingTools = function () {
    bindOnce();
    loadTimerPrefs();
    renderWater();
    showQuote();
  };

  // Auto-refresh when the ⚡ Tools tab is clicked (tab buttons are delegated
  // in client-portal.js; we simply listen and re-render when tools becomes active)
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.tab-btn[data-ctab="tools"]') : null;
    if (btn) window.refreshTrainingTools();
  }, true);

  // Boot once DOM is ready (works even before login — shows guest defaults)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { bindOnce(); loadTimerPrefs(); renderWater(); showQuote(); });
  } else {
    bindOnce(); loadTimerPrefs(); renderWater(); showQuote();
  }
})(window);
