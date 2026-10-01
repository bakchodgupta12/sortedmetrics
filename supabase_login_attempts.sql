-- ============================================================================
-- Login rate limiting — attempt tracker
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query).
--
-- RLS is enabled with NO policies, so only the server (secret key) can read or
-- write it — consistent with `sessions` and `app_data`.
-- ============================================================================

create table if not exists public.login_attempts (
  identifier        text primary key,          -- e.g. 'user:<username>' or 'ip:<ip>'
  attempt_count     integer not null default 0,
  first_attempt_at  timestamptz not null default now(),
  last_attempt_at   timestamptz not null default now(),
  locked_until      timestamptz                -- nullable; set when locked
);

alter table public.login_attempts enable row level security;

-- (No policies on purpose — the secret-key server client bypasses RLS; everyone
--  else is denied.)
