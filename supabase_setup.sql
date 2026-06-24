-- ============================================================================
-- Sorted Wallet Metrics Tracker — Supabase setup / migration
-- ============================================================================
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query).
-- It is idempotent and safe to re-run.
--
-- Model: the team shares ONE metrics dataset. `metrics_data` now holds only
-- ACCOUNTS (credentials + role); the shared metrics blob lives in a single
-- `shared_metrics` row. This script migrates an existing single-account
-- install by promoting that account to `owner` and copying its data into the
-- shared row, so existing data is preserved.
--
-- INTERNAL tool with custom username/password auth (no Supabase Auth). RLS is
-- enabled and the policies below allow the `anon` role full access. That is
-- acceptable for a small, trusted internal team; access control is in the app.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Accounts table (existing). Create on a fresh install.
-- ----------------------------------------------------------------------------
create table if not exists public.metrics_data (
  username                text primary key,
  display_name            text,
  password_hash           text not null,
  salt                    text not null,
  role                    text not null default 'member',
  data                    jsonb not null default '{"years": {}}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Migrate older installs: add `role`, and drop the now-removed security-question
-- columns (idempotent — no-ops on a fresh install).
alter table public.metrics_data add column if not exists role text not null default 'member';
alter table public.metrics_data drop column if exists security_question;
alter table public.metrics_data drop column if exists security_answer_hash;

-- Keep updated_at fresh on every write.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_metrics_data_updated_at on public.metrics_data;
create trigger trg_metrics_data_updated_at
  before update on public.metrics_data
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Shared metrics dataset — a single row (id = 1) read/written by every account.
-- ----------------------------------------------------------------------------
create table if not exists public.shared_metrics (
  id                      smallint primary key,
  data                    jsonb not null default '{"years": {}}'::jsonb,
  updated_at              timestamptz not null default now(),
  constraint shared_metrics_singleton check (id = 1)
);

drop trigger if exists trg_shared_metrics_updated_at on public.shared_metrics;
create trigger trg_shared_metrics_updated_at
  before update on public.shared_metrics
  for each row execute function public.set_updated_at();

-- Seed the shared row from the existing (single) account's data — preserves it.
insert into public.shared_metrics (id, data)
select 1, coalesce(data, '{"years": {}}'::jsonb)
  from public.metrics_data
  order by created_at asc
  limit 1
on conflict (id) do nothing;

-- Guarantee a shared row exists even on a brand-new install.
insert into public.shared_metrics (id, data)
values (1, '{"years": {}}'::jsonb)
on conflict (id) do nothing;

-- Promote the oldest existing account (the founding account) to owner.
update public.metrics_data
  set role = 'owner'
  where username = (
    select username from public.metrics_data order by created_at asc limit 1
  );

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.metrics_data enable row level security;
alter table public.shared_metrics enable row level security;

-- Drop existing policies so this script is re-runnable.
drop policy if exists "anon_select" on public.metrics_data;
drop policy if exists "anon_insert" on public.metrics_data;
drop policy if exists "anon_update" on public.metrics_data;
drop policy if exists "anon_delete" on public.metrics_data;

drop policy if exists "anon_select" on public.shared_metrics;
drop policy if exists "anon_insert" on public.shared_metrics;
drop policy if exists "anon_update" on public.shared_metrics;
drop policy if exists "anon_delete" on public.shared_metrics;

-- Allow the anon role full access. Access control happens in the client.
create policy "anon_select" on public.metrics_data for select to anon using (true);
create policy "anon_insert" on public.metrics_data for insert to anon with check (true);
create policy "anon_update" on public.metrics_data for update to anon using (true) with check (true);
create policy "anon_delete" on public.metrics_data for delete to anon using (true);

create policy "anon_select" on public.shared_metrics for select to anon using (true);
create policy "anon_insert" on public.shared_metrics for insert to anon with check (true);
create policy "anon_update" on public.shared_metrics for update to anon using (true) with check (true);
create policy "anon_delete" on public.shared_metrics for delete to anon using (true);
