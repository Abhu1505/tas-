// ============================================================
// ADMIN WORKSPACE — Home / Clients tabs, panel close buttons,
// report panel entry point and home stats.
// ------------------------------------------------------------
// The HTML uses data-atab2="home|clients" workspace buttons and
// ✕ (data-close-panel) buttons on every admin panel. These events
// are wired here so every top button/tab opens the right workspace.
// ============================================================
(function () {
  'use strict';

  // Show one of the admin workspaces (Home = create/stats, Clients = roster &
  // tools, Calculators = Fitness Calculator Hub).
  window.showAdminWorkspaceTab = function (tab) {
    const home = $('adminWorkspaceHome');
    const clients = $('adminWorkspaceClients');
    const calcs = $('adminWorkspaceCalculators');
    if (!home || !clients) return;
    home.classList.toggle('hidden', tab !== 'home');
    clients.classList.toggle('hidden', tab !== 'clients');
    if (calcs) calcs.classList.toggle('hidden', tab !== 'calculators');
    document.querySelectorAll('.tab-btn[data-atab2]').forEach(b =>
      b.classList.toggle('active', b.dataset.atab2 === tab));
    if (tab === 'clients' && typeof renderClientList === 'function') renderClientList();
    // 🧮 Calculators workspace: refresh the client dropdown + load selection.
    if (tab === 'calculators' && typeof window.refreshCalcClientSelect === 'function') {
      try { window.refreshCalcClientSelect(); } catch (e) {}
    }
  };

  // Open a client from anywhere (e.g. the Reports panel) — switches to the
  // Clients workspace and scrolls the detail panel into view.
  window.openClientFromAnywhere = function (clientId) {
    showAdminWorkspaceTab('clients');
    if (typeof selectClient === 'function') selectClient(clientId);
    const d = $('clientDetailPanel');
    if (d) setTimeout(() => d.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  // Reset to the Home workspace whenever a fresh login happens (clean UX).
  const origOpenAdmin = window.openAdminDashboard;
  if (origOpenAdmin && !window.__adminHomeResetWrapped) {
    window.__adminHomeResetWrapped = true;
    window.openAdminDashboard = function () {
      const out = origOpenAdmin.apply(this, arguments);
      try { showAdminWorkspaceTab('home'); } catch (e) {}
      return out;
    };
  }

  // SAFETY NET: even if some other script forgets to switch workspaces, any
  // click on an admin button that shows a panel inside the Clients workspace
  // automatically brings that workspace into view.
  document.addEventListener('click', (e) => {
    try {
      const btn = e.target && e.target.closest ? e.target.closest('.dash-header-actions button') : null;
      if (!btn) return;
      const clientsWs = $('adminWorkspaceClients');
      if (!clientsWs) return;
      setTimeout(() => {
        const anyPanelVisible = ['approvalsPanel', 'classTimesPanel', 'requestsPanel',
          'settingsPanel', 'libraryPanel', 'reportsPanel'].some(id => {
            const el = $(id);
            return el && !el.classList.contains('hidden');
          });
        if (anyPanelVisible && !clientsWs.classList.contains('hidden')) return;
        if (anyPanelVisible) showAdminWorkspaceTab('clients');
      }, 0);
    } catch (err) { /* never break the click chain */ }
  }, true);

  // WhatsApp helper used by the progress-report "Send to Client" button.
  window.notifyClientWhatsApp = function (client, message) {
    const phone = ((client && client.phone) || '').replace(/\D/g, '');
    if (!phone) { showStatus($('rpStatus'), '⚠️ This client has no WhatsApp number.', 'error'); return false; }
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const url = isMobile
      ? `whatsapp://send?phone=${phone}&text=${encodeURIComponent(message)}`
      : `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    return true;
  };

  // Live counters on the Home workspace + Clients tab badge.
  window.renderHomeStats = function () {
    const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const active = APP_STATE.clients.filter(c => c.active);
    set('hsTotalClients', APP_STATE.clients.length);
    set('hsActiveClients', active.length);
    const pend = window.getTruePendingCounts ? window.getTruePendingCounts().total
      : (APP_STATE.profileApprovals.filter(a => a.status === 'pending').length
        + APP_STATE.progressApprovals.filter(a => a.status === 'pending').length
        + (APP_STATE.workoutEditRequests || []).filter(r => r.status === 'pending').length);
    set('hsPendingApprovals', pend);
    let monthSessions = 0, revenue = 0;
    active.forEach(c => {
      const n = (typeof getSessions === 'function' ? getSessions(c.id, y, m).length : 0);
      monthSessions += n;
      revenue += n * (typeof getRate === 'function' ? getRate(c.id) : 0);
    });
    set('hsMonthSessions', monthSessions);
    set('hsMonthRevenue', revenue.toLocaleString());
    set('adminClientsTabCount', APP_STATE.clients.length);
  };

  window.bindWorkspaceEvents = function () {
    // 🏠 Home / 📋 Clients workspace switch
    document.querySelectorAll('.tab-btn[data-atab2]').forEach(btn => {
      btn.addEventListener('click', () => {
        window.showAdminWorkspaceTab(btn.dataset.atab2);
        if (btn.dataset.atab2 === 'home') renderHomeStats();
      });
    });

    // "📋 Open Clients Tab" shortcut on Home
    const goBtn = $('goToClientsTabBtn');
    if (goBtn) goBtn.addEventListener('click', () => window.showAdminWorkspaceTab('clients'));

    // ✕ close buttons on every admin panel (delegated — also covers panels
    // that other scripts re-inject dynamically)
    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-close-panel]') : null;
      if (!btn) return;
      const p = $(btn.dataset.closePanel);
      if (p) p.classList.add('hidden');
    });

    // Refresh home stats whenever data reloads (loadAllData calls renderClientList).
    const origRenderList = window.renderClientList;
    if (origRenderList && !window.__statsWrapped) {
      window.__statsWrapped = true;
      window.renderClientList = function () {
        const out = origRenderList.apply(this, arguments);
        try { renderHomeStats(); } catch (e) {}
        try { if (typeof updateGymNameSuggestions === 'function') updateGymNameSuggestions(); } catch (e) {}
        return out;
      };
    }
  };

  // If main.js already booted before this file loaded (script order changed),
  // announce readiness so its lazy fallback binds the workspace events.
  if (!window.__workspaceBound && document.readyState !== 'loading') {
    window.dispatchEvent(new Event('tas:workspace-ready'));
  }
})();
