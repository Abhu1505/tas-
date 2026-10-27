# Fix 💳 Incoming Payments tab — rows/cards not expanding to show details (Admin Panel)

Closes #(issue)

## Problem
In the Admin Panel, clicking the **💳 Incoming Payments** tab / pending transfer cards did nothing — the detail section never expanded. Users could not view payment details or approve/reject transfers from the admin panel.

## Root Causes
1. **js/animations.js** – The tab-animation `panelFor` map had no entry for the `payments` workspace, so the 💳 tab never received proper open/close handling (`v === 'payments' ? 'adminWorkspacePayments'` was missing).
2. **js/payments.js** *(core bug)* – Expand/collapse click handlers were attached directly to the panel container whose `innerHTML` is fully replaced on every re-render (triggered by the MutationObserver and by approve/reject flows). Freshly rendered cards therefore had **dead click handlers**.
3. **js/workspace.js** – After a render, a stale inline `display:none` value could be left on the host element, hiding the panel even when the tab was "open".
4. **PWA / browser cache** – Deployed users kept receiving the old broken bundle because cache-busting versions weren't bumped (`?v=45`, SW version `v47`).

## Changes
### js/payments.js
- Converted each pending transfer into an **accordion card** with a collapsible detail section: Client, Billing month(s), Amount, Method, Reference/UTR, Note, Declared at + Approve/Reject buttons.
- Expanded state stored in a persistent Set (`window.__tasPayExpanded`) keyed by row id → **survives every re-render**.
- Click / keyboard (Enter & Space) handlers are now **event-delegated once** on the persistent host element, so re-renders can never detach them.
- Added a re-entrant render guard so two simultaneous renders can't race and wipe handlers.
- 🔔 header toggle now flips both the class *and* the inline `display` (overrides `.hidden { display:none !important }`).
- Rotating ▶ chevron + `aria-expanded` for visual & accessibility feedback.

### js/animations.js
- Registered the `payments` workspace in the tab panel map so the 💳 tab animates open/closed correctly.

### js/workspace.js
- Force reflow + re-assert host visibility after render so the panel can never be left hidden by a stale value; tab still collapses/expands accordion-style.

### css/styles.css
- New `.tas-pay-card` / `.tas-pay-head` / `.tas-pay-detail` styles with a smooth slide-open animation and `prefers-reduced-motion` support.

### index.html & sw.js
- Cache-busted asset versions `v45 → v46` and bumped PWA cache `v47 → v48` so deployed users immediately get the fix instead of the old cached broken bundle.

### Cleanup
- Removed stray `IncomingPayments.jsx` (React file unused by this vanilla-JS app).

## Testing
- **New:** `smoke_payments.js` end-to-end test — all pass:
  - ✅ Tab click expands workspace + panel
  - ✅ Card click opens details
  - ✅ Second click collapses
  - ✅ Expanded state preserved across re-render
  - ✅ Handlers still functional after re-render
  - ✅ 🔔 Header toggle works
  - ✅ Tab accordion collapse / re-expand works
- **Regression:** existing `smoke.js` and `smoke2.js` pass with 0 errors.

## Files Changed
| File | Purpose |
|---|---|
| `js/payments.js` | Accordion UI, delegated handlers, persistent expand state, render guard |
| `js/animations.js` | Register `payments` workspace in tab-panel map |
| `js/workspace.js` | Post-render visibility re-assert + forced reflow |
| `css/styles.css` | Card/detail slide-open styles (+ reduced motion) |
| `index.html` | Cache bust v45→v46 |
| `sw.js` | PWA cache v47→v48 |
| `smoke_payments.js` | New e2e expansion test |
| `IncomingPayments.jsx` | Deleted (unused React leftover) |

## How to Verify
1. Open the Admin Panel → click **💳 Incoming Payments**.
2. Click any pending transfer card → its detail section slides open (chevron rotates).
3. Click again → it collapses.
4. Approve/reject a payment (forces a re-render) → previously expanded cards stay expanded and remain clickable.
5. Toggle the 🔔 header button → panel shows/hides correctly.
