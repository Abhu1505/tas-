-- ============================================================
-- 💳 CLIENT PAYMENTS — one-time migration (safe to re-run)
-- ------------------------------------------------------------
-- Run this once in Supabase → SQL Editor → New query → Run.
-- It creates the `client_payments` table used by the client portal's
-- "Pay For Your Sessions" card (js/payments.js) and adds the optional
-- payment-provider columns to `admin_config`, so the trainer can set
-- the provider / Stripe key from the cloud without redeploying.
-- Until this file is run, payments are stored locally (localStorage)
-- and queued for sync; the portal keeps working either way.
-- ============================================================

create table if not exists public.client_payments (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  invoice_key text not null,               -- e.g. '2026-10' (month billed)
  amount_due numeric not null default 0,   -- total settled (incl. carry-over)
  currency text not null default 'AED',
  method text not null default 'apple_pay',-- apple_pay | google_pay | card | cash_or_transfer
  reference text,                          -- PSP reference (payment intent / token id)
  status text not null default 'paid',     -- paid | pending | refunded
  created_at timestamptz not null default now()
);

create index if not exists cp_client_idx on public.client_payments (client_id, invoice_key);

alter table public.client_payments enable row level security;

drop policy if exists cp_select on public.client_payments;
create policy cp_select on public.client_payments for select using (true);

drop policy if exists cp_insert on public.client_payments;
create policy cp_insert on public.client_payments for insert with check (true);

drop policy if exists cp_update on public.client_payments;
create policy cp_update on public.client_payments for update using (true) with check (true);

-- Optional: let the trainer configure the payment provider from the cloud
-- (values here override js/config.js at runtime).
alter table public.admin_config add column if not exists payment_provider text;          -- 'stripe' | 'apple_pay_direct' | ''
alter table public.admin_config add column if not exists stripe_publishable_key text;    -- pk_live_… / pk_test_…
alter table public.admin_config add column if not exists apple_pay_merchant_id text;     -- merchant.com.yourdomain
