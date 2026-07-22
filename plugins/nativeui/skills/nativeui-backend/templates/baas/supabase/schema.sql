-- NativeUI x Supabase — starter schema
--
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It creates the tables your app reads/writes, turns on Row Level Security (RLS),
-- and adds owner-scoped policies so each signed-in user only sees their own rows.
--
-- These tables are INFERRED from a common signup/profile app shape. KEEP the ones your
-- screens actually use; rename/drop the rest. The non-negotiable parts are: every table
-- has RLS enabled, and every policy checks auth.uid() so a leaked anon key can't read
-- another user's data. supabase-js / the REST (PostgREST) API enforce these on every call.

-- ── extensions ──────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ── profiles ────────────────────────────────────────────────────────────────
-- One row per auth user. id == auth.users.id (the JWT subject). Auth itself lives in
-- Supabase Auth (auth.users) — never store passwords here; Supabase hashes them.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  bio         text,
  plan        text not null default 'free',     -- e.g. plan_select: free | pro | team
  newsletter  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── items ───────────────────────────────────────────────────────────────────
-- A generic per-user list table — the thing a CALL_DATABASE "load my rows" reads, and a
-- form-submit (SUBMIT_FORM / CALL_API) inserts. Rename to match your domain (tasks, trips,
-- orders, posts…). owner_id ties each row to its creator for RLS.
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  notes       text,
  status      text not null default 'open',
  amount_cents integer,                         -- e.g. budget_range / a price; store money as integer cents
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists items_owner_id_idx on public.items (owner_id);

-- ── updated_at trigger ──────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at before update on public.items
  for each row execute function public.set_updated_at();

-- ── auto-create a profile row on signup ─────────────────────────────────────
-- So a brand-new user already has a profiles row to read. Optional but convenient.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row Level Security ──────────────────────────────────────────────────────
-- RLS is OFF by default in Postgres; with it OFF + an anon key, anyone could read
-- everything. Turn it ON and add owner-scoped policies. Until a policy matches, every
-- row is denied — which is the safe default.
alter table public.profiles enable row level security;
alter table public.items    enable row level security;

-- profiles: a user can read/update only their own row (id == their JWT subject).
drop policy if exists "profiles: read own"   on public.profiles;
create policy "profiles: read own"   on public.profiles for select using  (auth.uid() = id);
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles for update using  (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own" on public.profiles for insert with check (auth.uid() = id);

-- items: full CRUD, but only on rows the caller owns.
drop policy if exists "items: read own"   on public.items;
create policy "items: read own"   on public.items for select using  (auth.uid() = owner_id);
drop policy if exists "items: insert own" on public.items;
create policy "items: insert own" on public.items for insert with check (auth.uid() = owner_id);
drop policy if exists "items: update own" on public.items;
create policy "items: update own" on public.items for update using  (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "items: delete own" on public.items;
create policy "items: delete own" on public.items for delete using  (auth.uid() = owner_id);

-- That's it. With RLS + these policies, the anon key you ship in the app is safe to
-- expose: it can only ever touch the signed-in user's own rows.
