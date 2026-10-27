// Wire up all DOM events and boot the app
(function () {
  'use strict';

  function bind() {
    // 🛡️ Safe binder: attaches a listener only when the element exists.
    // Previously dozens of unguarded $('id').addEventListener(...) calls for
    // admin-only elements ran first; a single missing element threw and
    // aborted every remaining binding — which is why most client-portal
    // buttons (tabs, modals, logout…) silently stopped working.
    const on = (id, evt, fn) => {
      const el = $(id);
      if (!el) return null;
      el.addEventListener(evt, fn);
      return el;
    };

    // Login
    on('unifiedLoginBtn', 'click', handleUnifiedLogin);
    on('passwordInput', 'keypress', e => { if (e.key === 'Enter') handleUnifiedLogin(); });
    on('loginIdInput', 'keypress', e => { if (e.key === 'Enter') handleUnifiedLogin(); });

    // Logout (two-step inline confirm — professional & fast)
    attachConfirmLogout($('clientLogoutBtn'));
    attachConfirmLogout($('adminLogoutBtn'));

    // Refresh cloud data (both dashboards)
    const bindRefresh = (btnId, after) => {
      const b = $(btnId);
      if (!b) return;
      b.addEventListener('click', async () => {
        b.disabled = true;
        const orig = b.textContent;
        b.textContent = '⏳ …';
        try { await refreshAllData(); if (after) after(); }
        finally { b.disabled = false; b.textContent = orig; }
      });
    };
    bindRefresh('clientRefreshBtn', () => {
      const c = APP_STATE.loggedInClient;
      if (c) renderClientDashboard(c);
    });
    bindRefresh('adminRefreshBtn', () => {
      renderClientList();
      if (APP_STATE.selectedClientId) { renderSessions(); renderAssignList(); renderAdminProgress(); }
      renderApprovals();
    });

    // Client search filter
    const searchInput = $('clientSearchInput');
    if (searchInput) searchInput.addEventListener('input', () => renderClientList());

    // Admin top buttons — resolved LAZILY at click time, because settings.js /
    // approvals.js etc. define these functions as window properties and the
    // reference captured at bind() time could go stale after a hot reload.
    const lazyBind = (btnId, fnName) => {
      const b = $(btnId);
      if (!b) return;
      b.addEventListener('click', () => {
        if (typeof window[fnName] === 'function') window[fnName]();
        else console.warn('Missing function:', fnName);
      });
    };
    lazyBind('sendAllTopBtn', 'sendToAllClients');
    lazyBind('notifyBtn', 'requestNotifyPermission');
    // 🔔 Client-portal bell — same handler, so "Enable" works for clients too
    // and both buttons stay in sync with the browser permission state.
    lazyBind('clientNotifyBtn', 'requestNotifyPermission');
    lazyBind('approvalsBtn', 'openApprovalsPanel');
    lazyBind('exerciseLibraryBtn', 'openLibraryPanel');
    lazyBind('openSettingsBtn', 'openSettingsPanel');
    lazyBind('saveSettingsBtn', 'saveSettings');

    // 🏢 Gym / Club tab inside the "Create Client" form — expand/collapse.
    document.querySelectorAll('.tab-btn[data-ctabform]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.ctabform;
        document.querySelectorAll('.tab-btn[data-ctabform]').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-content[id^="ctabform-"]').forEach(t => t.classList.toggle('hidden', t.id !== `ctabform-${tab}`));
      });
    });

    // ⏰ Class Times panel (js/class-times.js)
    if (typeof window.bindClassTimesEvents === 'function') window.bindClassTimesEvents();
    // 📊 Reports panel (js/reports.js exposes openReportsPanel).
    // NOTE: bind() runs at DOMContentLoaded, when reports.js may not be
    // loaded yet — so never test the function reference here. Bind the
    // click unconditionally and resolve the function lazily on click.
    const reportsBtn = $('reportsBtn');
    if (reportsBtn) {
      reportsBtn.addEventListener('click', () => {
        if (typeof window.openReportsPanel === 'function') window.openReportsPanel();
      });
    }

    // 🏠 Home / 📋 Clients workspaces + ✕ panel close buttons (js/workspace.js)
    if (typeof window.bindWorkspaceEvents === 'function') {
      window.__workspaceBound = true;
      window.bindWorkspaceEvents();
    } else {
      // workspace.js not loaded yet — bind as soon as it arrives.
      window.addEventListener('tas:workspace-ready', () => {
        if (!window.__workspaceBound && typeof window.bindWorkspaceEvents === 'function') {
          window.__workspaceBound = true;
          window.bindWorkspaceEvents();
        }
      });
      setTimeout(() => {
        if (!window.__workspaceBound && typeof window.bindWorkspaceEvents === 'function') {
          window.__workspaceBound = true;
          window.bindWorkspaceEvents();
        }
      }, 1500);
    }

    // Approvals tab buttons
    document.querySelectorAll('.tab-approval').forEach(btn => {
      btn.addEventListener('click', () => {
        APP_STATE.currentApprovalTab = btn.dataset.atab;
        document.querySelectorAll('.tab-approval').forEach(b => {
          b.classList.toggle('active', b === btn);
          b.classList.toggle('btn-orange-small', b === btn);
          b.classList.toggle('btn-secondary', b !== btn);
        });
        renderApprovals();
      });
    });
    document.querySelectorAll('.tab-approval-type').forEach(btn => {
      btn.addEventListener('click', () => {
        APP_STATE.currentApprovalType = btn.dataset.atype;
        document.querySelectorAll('.tab-approval-type').forEach(b => {
          b.classList.toggle('active', b === btn);
          b.classList.toggle('btn-orange-small', b === btn);
          b.classList.toggle('btn-secondary', b !== btn);
        });
        renderApprovals();
      });
    });

    // Exercise Library
    on('addExerciseBtn', 'click', () => openExerciseModal(null));
    on('cancelExerciseBtn', 'click', () => $('exerciseModal').classList.add('hidden'));
    on('saveExerciseBtn', 'click', async () => {
      const name = $('exName').value.trim();
      if (!name) { showStatus($('exerciseModalStatus'), '⚠️ Name required.', 'error'); return; }
      const payload = {
        name,
        category: $('exCategory').value.trim() || null,
        muscle_group: $('exMuscle').value.trim() || null,
        default_sets: parseInt($('exSets').value, 10) || null,
        default_reps: $('exReps').value.trim() || null,
        default_weight: $('exWeight').value.trim() || null,
        default_rest: $('exRest').value.trim() || null,
        notes: $('exNotes').value.trim() || null
      };
      try {
        $('saveExerciseBtn').disabled = true;
        const id = $('editExerciseId').value;
        if (id) {
          const { error } = await APP_STATE.supabaseClient.from('exercises').update(payload).eq('id', id);
          if (error) throw error;
          const idx = APP_STATE.exercises.findIndex(e => sameId(e.id, id));
          if (idx >= 0) APP_STATE.exercises[idx] = { ...APP_STATE.exercises[idx], ...payload };
        } else {
          const { data, error } = await APP_STATE.supabaseClient.from('exercises').insert(payload).select().single();
          if (error) throw error;
          APP_STATE.exercises.push(data);
        }
        APP_STATE.exercises.sort((a, b) => a.name.localeCompare(b.name));
        renderLibrary();
        $('exerciseModal').classList.add('hidden');
      } catch (err) {
        showStatus($('exerciseModalStatus'), `❌ ${err.message}`, 'error');
      } finally {
        $('saveExerciseBtn').disabled = false;
      }
    });

    // Create client
    on('createClientBtn', 'click', createClient);
    on('pickContactBtn', 'click', pickFromContacts);

    // Client detail actions
    on('closeClientBtn', 'click', closeSelectedClient);
    on('reopenClientBtn', 'click', reopenSelectedClient);
    on('deleteClientBtn', 'click', openDeleteClientModal);
    on('viewLastSessionBtn', 'click', showMonthSummary);
    on('ratePerSession', 'change', updateRatePerSession);

    // Reminder
    on('reminderNote', 'input', saveReminderNote);
    on('sendWhatsappBtn', 'click', () => sendReminder('whatsapp'));
    on('sendEmailBtn', 'click', () => sendReminder('email'));

    // Month selector
    on('monthSelect', 'change', changeMonth);

    // Day log modal
    on('addExerciseToggleBtn', 'click', () => {
      const body = $('addExerciseBody');
      const btn = $('addExerciseToggleBtn');
      const open = body.classList.toggle('hidden');
      btn.setAttribute('aria-expanded', String(!open));
      btn.querySelector('.aet-chevron').textContent = open ? '▾' : '▴';
    });
    on('closeDayLogBtn', 'click', () => $('dayLogModal').classList.add('hidden'));
    on('freeAddBtn', 'click', async () => {
      const name = $('freeExName').value.trim();
      if (!name) { $('freeExName').focus(); return; }
      const matched = APP_STATE.exercises.find(e => e.name.toLowerCase() === name.toLowerCase());
      await addExerciseToDay({ name: matched ? matched.name : name, exercise_id: matched ? matched.id : null });
      $('freeExName').value = '';
      openDayLogModal(APP_STATE.selectedDay);
    });
    on('freeExName', 'keypress', e => {
      if (e.key === 'Enter') { e.preventDefault(); $('freeAddBtn').click(); }
    });

    // Set time modal
    on('cancelSetTimeBtn', 'click', () => $('setTimeModal').classList.add('hidden'));
    on('saveSetTimeBtn', 'click', async () => {
      const dateStr = $('stDayDate').value;
      const timeVal = $('stTime').value;
      const noteVal = $('stNote').value.trim();
      if (!dateStr || !timeVal) { showStatus($('setTimeStatus'), '⚠️ Time required.', 'error'); return; }
      try {
        $('saveSetTimeBtn').disabled = true;
        const { error } = await APP_STATE.supabaseClient.from('daily_times').upsert(
          { client_id: APP_STATE.selectedClientId, day_date: dateStr, class_time: timeVal, note: noteVal || null },
          { onConflict: 'client_id,day_date' }
        );
        if (error) throw error;
        if (!clientMapGet(APP_STATE.dailyTimesCache, APP_STATE.selectedClientId)) clientMapSet(APP_STATE.dailyTimesCache, APP_STATE.selectedClientId, []);
        const dtList = clientMapGet(APP_STATE.dailyTimesCache, APP_STATE.selectedClientId);
        for (let i = dtList.length - 1; i >= 0; i--) {
          if (dtList[i].day_date === dateStr) dtList.splice(i, 1);
        }
        dtList.push({ day_date: dateStr, class_time: timeVal, note: noteVal || null });
        $('setTimeModal').classList.add('hidden');
        renderSessions();
      } catch (err) {
        showStatus($('setTimeStatus'), '❌ ' + err.message, 'error');
      } finally {
        $('saveSetTimeBtn').disabled = false;
      }
    });
    on('clearSetTimeBtn', 'click', async () => {
      const dateStr = $('stDayDate').value;
      if (!dateStr) return;
      if (!await uiConfirm({ title: 'Clear Class Time', message: 'Clear the time for this day?', confirmText: '🗑️ Clear', danger: true })) return;
      try {
        await APP_STATE.supabaseClient.from('daily_times').delete()
          .eq('client_id', APP_STATE.selectedClientId).eq('day_date', dateStr);
        clientMapSet(APP_STATE.dailyTimesCache, APP_STATE.selectedClientId,
          (clientMapGet(APP_STATE.dailyTimesCache, APP_STATE.selectedClientId) || []).filter(d => d.day_date !== dateStr));
        $('setTimeModal').classList.add('hidden');
        renderSessions();
      } catch (err) { showStatus($('setTimeStatus'), '❌ Failed: ' + err.message, 'error'); }
    });

    // Month summary modal
    on('closeMonthSummaryBtn', 'click', () => $('monthSummaryModal').classList.add('hidden'));

    // Progress modal
    on('cancelProgressBtn', 'click', () => $('progressModal').classList.add('hidden'));
    on('saveProgressBtn', 'click', saveProgress);
    // ➕ Add Entry — routed through the guarded opener in js/client-portal.js
    // (lazy lookup + try/catch, works even if main.js bind() partially failed).
    const adminAddBtn = $('adminAddProgressBtn');
    if (adminAddBtn) adminAddBtn.addEventListener('click', () => {
      if (!APP_STATE.selectedClientId) return;
      if (typeof window.openProgressModal === 'function') openProgressModal(null, APP_STATE.selectedClientId, 'admin');
    });
    const clientAddBtn = $('clientAddProgressBtn');
    if (clientAddBtn) clientAddBtn.addEventListener('click', () => {
      if (typeof window.tasOpenAddEntry === 'function') window.tasOpenAddEntry();
      else if (APP_STATE.loggedInClient && typeof window.openProgressModal === 'function') {
        openProgressModal(null, APP_STATE.loggedInClient.id, 'client');
      }
    });

    // ✏️ Edit Profile modal was MERGED into 👤 My Profile (js/progress.js
    // renders one inline form: basic details + 📌 Shared Inputs, submitted
    // for approval together via "📩 Save to Profile"). The old modal's
    // buttons no longer exist, so nothing is bound here anymore.

    // Wipe modal
    on('clearAllBtn', 'click', openWipeModal);
    on('cancelClearAllBtn', 'click', () => $('clearAllModal').classList.add('hidden'));
    on('clearConfirmInput', 'input', (e) => {
      $('confirmClearAllBtn').disabled = e.target.value.trim() !== 'DELETE';
    });
    on('confirmClearAllBtn', 'click', performWipe);

    // Delete client modal
    on('cancelDeleteClientBtn', 'click', () => $('deleteClientModal').classList.add('hidden'));
    on('deleteConfirmInput', 'input', (e) => {
      $('confirmDeleteClientBtn').disabled = e.target.value.trim() !== 'DELETE';
    });
    on('confirmDeleteClientBtn', 'click', confirmDeleteClient);

    // Client dashboard tabs
    document.querySelectorAll('.tab-btn[data-ctab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.ctab;
        document.querySelectorAll('.tab-btn[data-ctab]').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-content[id^="ctab-"]').forEach(t => t.classList.toggle('hidden', t.id !== `ctab-${tab}`));
      });
    });

    // Admin client detail tabs
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-content[id^="tab-"]').forEach(t => t.classList.toggle('hidden', t.id !== `tab-${tab}`));
        if (tab === 'progress' && typeof window.renderProgressDashboard === 'function') window.renderProgressDashboard();
      });
    });
  }

  function attachConfirmLogout(btn) {
    if (!btn) return;
    let armed = false, t = null;
    const original = btn.textContent;
    btn.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Confirm?';
        btn.classList.add('btn-danger');
        t = setTimeout(() => { armed = false; btn.textContent = original; btn.classList.remove('btn-danger'); }, 3000);
        return;
      }
      clearTimeout(t);
      armed = false;
      btn.textContent = original;
      btn.classList.remove('btn-danger');
      unifiedLogout();
      showToast('👋 Signed out successfully.', 'info', 2500);
    });
  }

  function boot() {
    // Footer year + live portal URL (same link that goes out in WhatsApp messages)
    const fy = $('footerYear'); if (fy) fy.textContent = new Date().getFullYear();
    const fu = $('footerAppUrl');
    if (fu) { try { fu.textContent = APP_CONFIG.LOGIN_URL.replace(/^https?:\/\//, ''); } catch (e) { fu.textContent = ''; } }

    // Default month dropdown
    const ms = $('monthSelect');
    if (ms) { ms.value = new Date().getMonth(); APP_STATE.selectedMonth = new Date().getMonth(); APP_STATE.selectedYear = new Date().getFullYear(); }

    // Password toggles
    initPasswordToggles();

    // Contact picker support
    initContactPicker();

    // Light/dark theme toggle (restores saved preference)
    if (typeof window.initThemeToggle === 'function') window.initThemeToggle();

    // Wire all events
    bind();

    // NEW: wire up the library cascading dropdowns
    if (typeof initLibraryDropdowns === 'function') initLibraryDropdowns();

    // ESC key closes any open modal or admin panel (professional UX)
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
      ['settingsPanel', 'libraryPanel', 'approvalsPanel', 'classTimesPanel',
        'reportsPanel', 'requestsPanel'].forEach(id => {
        const el = $(id); if (el) el.classList.add('hidden');
      });
    });

    // Boot cloud + data (waits for Supabase SDK inside initSupabase)
    initSupabase();

    // Late init for drive images (after full load, in case <img> tags were added dynamically)
    window.addEventListener('load', () => {
      if (window.DriveImages) window.DriveImages.init();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

/* ============================================================
   📌 FIXED CLIENT HEADER — keep the pinned "Welcome back" bar and
   pending-approval banner in sync on phones (CSS @media ≤700px).
   Measures real heights and feeds them to CSS custom properties so
   content never hides under the fixed header, even when the banner
   appears/disappears or tabs wrap onto two lines.
   ============================================================ */
(function clientHeaderPin(){
  const dash = document.getElementById('clientDashboard');
  if (!dash) return;
  function sync(){
    if (window.innerWidth > 700 || dash.classList.contains('hidden')){
      document.documentElement.style.removeProperty('--client-head-clear');
      document.documentElement.style.removeProperty('--client-head-h');
      return;
    }
    const head = dash.querySelector('.dash-header.client-dash-header') || dash.querySelector('.dash-header');
    const banner = document.getElementById('clientPendingBanner');
    const headH = head ? head.getBoundingClientRect().height : 56;
    const bannerH = (banner && !banner.classList.contains('hidden')) ? banner.getBoundingClientRect().height + 8 : 0;
    document.documentElement.style.setProperty('--client-head-h', Math.round(headH) + 'px');
    document.documentElement.style.setProperty('--client-head-clear', Math.round(headH + bannerH + 8) + 'px');
  }
  window.addEventListener('resize', sync, {passive:true});
  window.addEventListener('orientationchange', () => setTimeout(sync, 250));
  if (window.MutationObserver){
    new MutationObserver(sync).observe(dash, {attributes:true, subtree:true, attributeFilter:['class']});
  }
  // Re-sync after tab switches re-render the dashboard
  ['ctab-plan','ctab-history','ctab-progress','ctab-calculators','ctab-profile'].forEach(()=>{});
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.client-tabs')) setTimeout(sync, 60); });
  const boot = () => { sync(); setTimeout(sync, 400); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

})();