-- ============================================================================
-- Sorted Wallet Metrics Tracker — Supabase setup
-- ============================================================================
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query).
--
-- This is an INTERNAL tool with custom username/password auth (no Supabase
-- Auth). There is no auth.uid(); access is gated entirely in the client.
-- RLS is enabled and the policies below allow the `anon` role full access to
-- the table. That is acceptable for a small, trusted internal team.
-- ============================================================================

create table if not exists public.metrics_data (
  username                text primary key,
  display_name            text,
  password_hash           text not null,
  salt                    text not null,
  security_question       text not null,
  security_answer_hash    text not null,
  data                    jsonb not null default '{"years": {}}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

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
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.metrics_data enable row level security;

-- Drop existing policies so this script is re-runnable.
drop policy if exists "anon_select" on public.metrics_data;
drop policy if exists "anon_insert" on public.metrics_data;
drop policy if exists "anon_update" on public.metrics_data;
drop policy if exists "anon_delete" on public.metrics_data;

-- Allow the anon role full access. Access control happens in the client.
create policy "anon_select" on public.metrics_data
  for select to anon using (true);

create policy "anon_insert" on public.metrics_data
  for insert to anon with check (true);

create policy "anon_update" on public.metrics_data
  for update to anon using (true) with check (true);

create policy "anon_delete" on public.metrics_data
  for delete to anon using (true);
