-- ============================================================
-- 💳 CLIENT PAYMENTS — one-time migration (safe to re-run)
-- ------------------------------------------------------------
-- Run this once in Supabase → SQL Editor → New query → Run.
-- It creates the `client_payments` table used by the client portal's
-- "Pay For Your Sessions" card (js/payments.js) and adds the bank /
-- PayPal detail columns to `admin_config`, so the trainer can update
-- their account details from the admin panel without redeploying.
-- All payments are DIRECT-TO-COACH (bank transfer / PayPal.me) — no
-- third-party gateway or API keys involved.
-- Until this file is run, payments are stored locally (localStorage)
-- and queued for sync; the portal keeps working either way.
-- ============================================================

create table if not exists public.client_payments (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  invoice_key text not null,               -- e.g. '2026-10' (month billed)
  amount_due numeric not null default 0,   -- total settled (incl. carry-over)
  currency text not null default 'AED',
  method text not null default 'bank_transfer', -- bank_transfer | paypal | cash_or_transfer
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

-- 🏦 Direct bank transfer / PayPal details shown in every client portal.
-- The trainer can also edit these live from the admin "💳 Incoming Payments"
-- panel — this just makes the columns exist so the values persist in cloud.
-- status on client_payments now also includes 'pending' (client declared a
-- bank/PayPal transfer, awaiting coach verification) and 'rejected'.
alter table public.admin_config add column if not exists bank_transfer_enabled boolean default true;
alter table public.admin_config add column if not exists bank_name text;
alter table public.admin_config add column if not exists bank_account_name text;
alter table public.admin_config add column if not exists bank_iban text;
alter table public.admin_config add column if not exists bank_swift text;
alter table public.admin_config add column if not exists bank_upi_id text;
alter table public.admin_config add column if not exists paypal_me_link text;
