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
  LOGO_FILE_ID: '1N651kHeVrz6HEhAc1cRRKGx2DtS-IdX0'
};