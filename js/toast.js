// ============================================================
// Professional toast notification system + confirm dialogs.
// Replaces raw alert()/confirm() with styled, accessible UI.
// Falls back to native dialogs if anything goes wrong.
// ============================================================
(function (window) {
  'use strict';

  const ICONS = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

  function ensureContainer() {
    let c = document.getElementById('toastContainer');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toastContainer';
      c.setAttribute('role', 'status');
      c.setAttribute('aria-live', 'polite');
      document.body.appendChild(c);
    }
    return c;
  }

  /**
   * Show a toast message.
   * @param {string} msg  Message text (HTML-escaped before insert).
   * @param {string} type 'success' | 'error' | 'warning' | 'info'
   * @param {number} ms   Duration in ms (default 4000; errors get 6000).
   */
  window.showToast = function (msg, type = 'info', ms) {
    try {
      const container = ensureContainer();
      const t = document.createElement('div');
      t.className = `toast toast-${type}`;
      const icon = ICONS[type] || ICONS.info;
      t.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg"></span>` +
        `<button class="toast-close" aria-label="Dismiss">✕</button>`;
      t.querySelector('.toast-msg').textContent = String(msg ?? '');
      container.appendChild(t);
      requestAnimationFrame(() => t.classList.add('show'));
      const duration = ms || (type === 'error' ? 6000 : 4000);
      const remove = () => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 250);
      };
      t.querySelector('.toast-close').addEventListener('click', remove);
      setTimeout(remove, duration);
      // Keep max 5 toasts on screen
      while (container.children.length > 5) container.firstChild.remove();
    } catch (e) {
      // Ultimate fallback
      try { window.alert(msg); } catch (_) {}
    }
  };

  /**
   * Promise-based professional confirmation dialog.
   * resolve(true) on confirm, resolve(false) on cancel/dismiss.
   * @param {Object} opts { title, message, confirmText, cancelText, danger }
   */
  window.uiConfirm = function (opts) {
    opts = typeof opts === 'string' ? { message: opts } : (opts || {});
    return new Promise((resolve) => {
      let overlay = document.getElementById('uiConfirmOverlay');
      try {
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'uiConfirmOverlay';
          overlay.className = 'modal-overlay hidden';
          overlay.innerHTML = `
            <div class="modal-box ui-confirm-box" role="alertdialog" aria-modal="true">
              <div class="modal-header orange" id="uiConfirmHeader"><h3 id="uiConfirmTitle">Please confirm</h3></div>
              <div class="modal-body">
                <div class="ui-confirm-message" id="uiConfirmMessage"></div>
                <div class="modal-actions">
                  <button class="btn-danger" id="uiConfirmOk">Confirm</button>
                  <button class="btn-secondary" id="uiConfirmCancel">Cancel</button>
                </div>
              </div>
            </div>`;
          document.body.appendChild(overlay);
        }
        const header = overlay.querySelector('#uiConfirmHeader');
        header.classList.toggle('red', !!opts.danger);
        header.classList.toggle('orange', !opts.danger);
        overlay.querySelector('#uiConfirmTitle').textContent = opts.title || 'Please confirm';
        // Support multi-line messages (convert \n to <br>, escape HTML first)
        const msgEl = overlay.querySelector('#uiConfirmMessage');
        const lines = String(opts.message || '').split('\n').map(l => escapeHtmlSafe(l));
        msgEl.innerHTML = lines.join('<br>');
        const okBtn = overlay.querySelector('#uiConfirmOk');
        const cancelBtn = overlay.querySelector('#uiConfirmCancel');
        okBtn.textContent = opts.confirmText || 'Confirm';
        cancelBtn.textContent = opts.cancelText || 'Cancel';

        const done = (val) => {
          overlay.classList.add('hidden');
          document.removeEventListener('keydown', onKey);
          resolve(val);
        };
        okBtn.onclick = () => done(true);
        cancelBtn.onclick = () => done(false);
        overlay.onclick = (e) => { if (e.target === overlay) done(false); };
        function onKey(e) {
          if (e.key === 'Escape') done(false);
          if (e.key === 'Enter') done(true);
        }
        document.addEventListener('keydown', onKey);
        overlay.classList.remove('hidden');
        okBtn.focus();
      } catch (e) {
        // Fallback to native confirm
        resolve(window.confirm(opts.message || 'Are you sure?'));
      }
    });
  };

  function escapeHtmlSafe(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  }
})(window);
