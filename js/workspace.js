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
  // tools, Calculators = Fitness Calculator Hub, Payments = 💳 Incoming
  // Payments panel — moved out of the floating side bubble into this tab).
  window.showAdminWorkspaceTab = function (tab) {
    // 🪗 CLICK-TO-EXPAND: every admin workspace tab opens ONLY when it is
    // clicked. Clicking the tab that is ALREADY open collapses it again —
    // all workspaces hide and no tab stays highlighted until the next click.
    if (tab && window.__activeAdminTab === tab) {
      window.__activeAdminTab = null;
      ['adminWorkspaceHome', 'adminWorkspaceClients', 'adminWorkspaceCalculators', 'adminWorkspacePayments']
        .forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
      document.querySelectorAll('.tab-btn[data-atab2]').forEach(b => b.classList.remove('active'));
      const payHostCollapse = $('adminPaymentPanelHost');
      if (payHostCollapse) payHostCollapse.style.display = 'none';
      return;
    }
    window.__activeAdminTab = tab || null;
    const home = $('adminWorkspaceHome');
    const clients = $('adminWorkspaceClients');
    const calcs = $('adminWorkspaceCalculators');
    const pays = $('adminWorkspacePayments');
    if (!home || !clients) return;
    home.classList.toggle('hidden', tab !== 'home');
    clients.classList.toggle('hidden', tab !== 'clients');
    if (calcs) calcs.classList.toggle('hidden', tab !== 'calculators');
    if (pays) pays.classList.toggle('hidden', tab !== 'payments');
    // 💳 The Incoming Payments panel lives inside the payments workspace;
    // show/hide its content with the tab (js/payments.js re-renders it).
    const payHost = $('adminPaymentPanelHost');
    if (payHost) {
      // Force reflow so the display change always applies even if a
      // previous inline style / animation frame raced with this write.
      payHost.style.display = '';
      void payHost.offsetHeight;
      payHost.style.display = tab === 'payments' ? 'block' : 'none';
    }
    if (tab === 'payments' && typeof window.renderAdminPaymentPanel === 'function') {
      try {
        window.renderAdminPaymentPanel();
        // Re-assert visibility AFTER the render: renderAdminPaymentPanel
        // re-checks workspace classes itself; this guarantees the host is
        // never left display:none by a stale value from an earlier render.
        if (payHost) payHost.style.display = 'block';
      } catch (e) {}
    }
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
      // 🪗 Start COLLAPSED: no workspace is expanded until the trainer
      // clicks one of the top tabs (click again collapses it — accordion).
      try {
        window.__activeAdminTab = null;
        ['adminWorkspaceHome', 'adminWorkspaceClients', 'adminWorkspaceCalculators', 'adminWorkspacePayments']
          .forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
        document.querySelectorAll('.tab-btn[data-atab2]').forEach(b => b.classList.remove('active'));
        const payHostInit = $('adminPaymentPanelHost');
        if (payHostInit) payHostInit.style.display = 'none';
        renderHomeStats();
      } catch (e) {}
      return out;
    };
  }

  // 🪗 CLIENT PORTAL TABS — same click-to-expand behaviour: clicking the
  // active tab collapses its content; clicking it again re-expands. The
  // first visit to each tab still runs its lazy hooks (PDF button etc.).
  const clientTabHooks = { calculators: () => { try { if (typeof window.injectTasPdfButton === 'function') window.injectTasPdfButton(); } catch (e) {} } };
  window.__tasBindCollapseTabs = function (sel, prefix) {
    document.querySelectorAll(sel).forEach(btn => {
      if (btn.dataset.tasCollapseBound === '1') return;
      btn.dataset.tasCollapseBound = '1';
      btn.addEventListener('click', () => {
        const wasActive = btn.classList.contains('active');
        const contents = document.querySelectorAll('.tab-content[id^="' + prefix + '-"]');
        if (wasActive) {
          // collapse — hide the open panel and de-highlight every tab
          contents.forEach(t => t.classList.add('hidden'));
          document.querySelectorAll(sel).forEach(b => b.classList.remove('active'));
          return;
        }
        document.querySelectorAll(sel).forEach(b => b.classList.toggle('active', b === btn));
        contents.forEach(t => t.classList.toggle('hidden', t.id !== prefix + '-' + btn.dataset[keyOf(prefix)]));
        const hook = clientTabHooks[btn.dataset[keyOf(prefix)]];
        if (hook) hook();
      }, true); // capture phase → always wins over older generic handlers
    });
  };
  function keyOf(prefix) { return prefix; } // data-ctab → dataset.ctab, data-tab → dataset.tab

  const origBindWs = window.bindWorkspaceEvents;
  if (origBindWs && !window.__collapseTabsWrapped) {
    window.__collapseTabsWrapped = true;
    window.bindWorkspaceEvents = function () {
      const out = origBindWs.apply(this, arguments);
      try { window.__tasBindCollapseTabs('.tab-btn[data-ctab]', 'ctab'); } catch (e) {}
      try { window.__tasBindCollapseTabs('.tab-btn[data-tab]', 'tab'); } catch (e) {}
      try { window.__tasBindCollapseTabs('.tab-btn[data-ctabform]', 'ctabform'); } catch (e) {}
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
    // 💳 Revenue counts only UNPAID session value: once a client settles an
    //    invoice via the portal (js/payments.js), those sessions no longer
    //    count as outstanding revenue.
    const isPaidMonth = (cid, yy, mm) => {
      const key = `${yy}-${String(mm + 1).padStart(2, '0')}`;
      const rows = APP_STATE.clientPayments || [];
      const covers = (r) => String(r.invoice_key || '').split('+').indexOf(key) !== -1;
      // Only 'paid' rows count as settled — 'pending' bank-transfer
      // declarations are still outstanding until the trainer approves them.
      const isLocalPaid = () => {
        try {
          const loc = JSON.parse(localStorage.getItem('tas_client_payments_v1') || '[]');
          return loc.some(r => String(r.client_id) === String(cid) && covers(r) && String(r.status || 'paid') === 'paid');
        } catch (e) { return false; }
      };
      return rows.some(r => String(r.client_id ?? '') === String(cid) && covers(r) && String(r.status || 'paid') === 'paid') || isLocalPaid();
    };
    active.forEach(c => {
      const n = (typeof getSessions === 'function' ? getSessions(c.id, y, m).length : 0);
      monthSessions += n;
      if (!isPaidMonth(c.id, y, m)) revenue += n * (typeof getRate === 'function' ? getRate(c.id) : 0);
    });
    set('hsMonthSessions', monthSessions);
    set('hsMonthRevenue', revenue.toLocaleString());
    set('adminClientsTabCount', APP_STATE.clients.length);
  };

  window.bindWorkspaceEvents = function () {
    // 🏠 Home / 📋 Clients workspace switch — click-to-expand, click the
    // same tab again to collapse (handled inside showAdminWorkspaceTab).
    document.querySelectorAll('.tab-btn[data-atab2]').forEach(btn => {
      if (btn.dataset.atab2Bound === '1') return;
      btn.dataset.atab2Bound = '1';
      btn.addEventListener('click', () => {
        const wasActive = btn.classList.contains('active');
        window.showAdminWorkspaceTab(btn.dataset.atab2);
        // Re-opening a collapsed tab: make sure its active highlight is on
        // (collapse path removed it; expand path sets it again anyway).
        if (!wasActive && window.__activeAdminTab === btn.dataset.atab2) {
          document.querySelectorAll('.tab-btn[data-atab2]').forEach(b =>
            b.classList.toggle('active', b === btn));
        }
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
