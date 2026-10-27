// Global config + constants
window.APP_CONFIG = {
  SUPABASE_URL: 'https://tacgfjxutmdpcatztcpu.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhY2dmanh1dG1kcGNhdHp0Y3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4OTEwOTYsImV4cCI6MjEwNTQ2NzA5Nn0.FpqZOgvf6ATllwPPMFLAkz_3HvexD4aztFQTY-FgQZw',
  CURRENCY: 'AED',
  CURRENT_YEAR: new Date().getFullYear(),
  DEFAULT_ADMIN_ID: 'TAS-Abhi',
  DEFAULT_ADMIN_PW: 'Abhu@1818',
  // Optional: service_role key — ONLY needed if you want the app to auto-create
  // missing tables (e.g. workout_edit_requests) from the browser. Leave empty
  // otherwise; running sql/workout_edit_requests.sql once in the Supabase SQL
  // editor is the safer way.
  SUPABASE_SERVICE_KEY: '',
  // Trainer's WhatsApp number (with country code) — client requests (edit-day,
  // profile/progress approval) automatically open a WhatsApp chat to this
  // number so the trainer is notified instantly. Change it here once.
  TRAINER_WHATSAPP: '971527739786',
  // Hardcoded admin credentials are restored by a cloud wipe (below) instead
  // of being deleted from Supabase. Set to true only if you also want the
  // admin_config row itself removed from the cloud during "Wipe All Data".
  WIPE_ADMIN_CONFIG_ROW: false,
  // Always use the URL currently open in the browser (works on localhost, Netlify preview, and production)
  get LOGIN_URL() { return window.location.href.split('#')[0]; },
  LOGO_FILE_ID: '1N651kHeVrz6HEhAc1cRRKGx2DtS-IdX0',
  // ---- 💳 PAYMENTS (see js/payments.js) --------------------------------
  // Direct-to-coach payments only — NO third-party gateway, NO API keys.
  // If no payment provider is ever needed again; the offline/cash ledger
  // below covers everything (amount due carries over until paid).
  // ---- 🏦 DIRECT BANK TRANSFER (money lands straight in YOUR account) --
  // No API keys or payment gateway needed for this. Fill in your own bank
  // details below and clients see a "🏦 Bank Transfer" button with your
  // account info + the exact amount due; they transfer directly to you,
  // then tick "I have paid". The trainer verifies the money arrived and
  // approves it from the Payments section — only then does the client's
  // amount due clear. Unverified/pending payments keep the balance due,
  // so it still carries over month-to-month until actually settled.
  BANK_TRANSFER_ENABLED: true,       // false hides the bank-transfer button
  BANK_NAME: '',                     // e.g. 'Mashreq Bank'
  BANK_ACCOUNT_NAME: '',             // e.g. 'TAS Personal Training'
  BANK_IBAN: '',                     // e.g. 'AE07 0331 2345 6789 0123 456'
  BANK_SWIFT: '',                    // optional SWIFT/BIC for int'l transfers
  BANK_UPI_ID: '',                   // optional UPI ID for Indian clients
  // PayPal.me link — another direct option: pays straight into your PayPal.
  // Clients in any country can then pay inside PayPal with their linked
  // Visa/Mastercard, Apple Pay or Samsung Pay — free for personal accounts,
  // no API keys, money lands directly in your PayPal.
  // e.g. 'https://paypal.me/yourhandle'. Leave '' to hide the button.
  PAYPAL_ME_LINK: ''
};