-- ============================================================================
-- Friday Elite — Migration 0002
-- Phone + password authentication backed by the Supabase Email provider.
--
-- This migration:
--   1. Allows the non-admin role value 'user' (existing 'player' rows stay valid).
--   2. Creates the protected phone -> internal-email mapping table.
--   3. Replaces handle_new_user() so email-backed accounts are provisioned as
--      role = 'user', status = 'pending', using the phone passed in metadata.
--   4. Replaces bootstrap_first_admin() so it resolves accounts through the
--      mapping table (email-backed auth users have auth.users.phone = null).
--
-- Run this ONCE in the Supabase SQL editor (or with `supabase db push` if your
-- migration history is in sync). Do not edit 0001.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Role values
-- ----------------------------------------------------------------------------
-- 0001 only allowed ('admin', 'player'). New accounts are created as 'user'.
-- 'player' is kept so existing rows and older code continue to work.
alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'player', 'user'));

alter table public.profiles alter column role set default 'user';

-- ----------------------------------------------------------------------------
-- 2. Phone <-> internal email mapping
-- ----------------------------------------------------------------------------
create table if not exists public.phone_email_map (
  id             uuid primary key references auth.users (id) on delete cascade,
  phone          text not null,
  internal_email text not null,
  created_at     timestamptz not null default now(),
  constraint phone_email_map_phone_key unique (phone),
  constraint phone_email_map_email_key unique (internal_email),
  constraint phone_email_map_phone_fmt check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint phone_email_map_email_fmt check (internal_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

alter table public.phone_email_map enable row level security;

-- Remove any policy from an earlier draft, then deny every client role.
-- Service-role requests bypass RLS and are the only intended consumers.
drop policy if exists service_role_only on public.phone_email_map;
drop policy if exists phone_email_map_service_role on public.phone_email_map;
create policy phone_email_map_service_role
  on public.phone_email_map
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.phone_email_map from public;
revoke all on table public.phone_email_map from anon;
revoke all on table public.phone_email_map from authenticated;
grant select, insert, update, delete on table public.phone_email_map to service_role;

comment on table public.phone_email_map is
  'Server-only map from a user-facing E.164 phone number to the internal email used by Supabase Auth. Never exposed to clients.';

-- ----------------------------------------------------------------------------
-- 3. Profile provisioning for email-backed Auth users
-- ----------------------------------------------------------------------------
-- The Edge Functions pass the normalized phone in user_metadata.phone, so the
-- trigger does not depend on auth.users.phone (which stays null for these
-- accounts). Role and status are hardcoded; client input can never set them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_phone text;
begin
  v_name := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  v_phone := nullif(btrim(coalesce(new.phone, new.raw_user_meta_data ->> 'phone', '')), '');

  if v_name is null or char_length(v_name) < 2 then
    v_name := 'لاعب جديد';
  end if;
  v_name := left(v_name, 80);

  v_phone := regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g');

  if v_phone !~ '^[1-9][0-9]{6,14}$' then
    raise exception 'PHONE_REQUIRED'
      using hint = 'A valid international phone number is required.';
  end if;

  v_phone := left('+' || v_phone, 16);

  insert into public.profiles (id, full_name, phone, role, status)
  values (new.id, v_name, v_phone, 'user', 'pending')
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

-- ----------------------------------------------------------------------------
-- 4. First-admin bootstrap
-- ----------------------------------------------------------------------------
-- Resolves the account through phone_email_map first, with a fallback to
-- auth.users.phone for any legacy phone-auth accounts. Accepts either
-- non-admin role value ('player' or 'user').
create or replace function public.bootstrap_first_admin(p_phone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_digits  text;
  v_id      uuid;
  v_count   integer;
  v_profile public.profiles%rowtype;
begin
  if (select auth.uid()) is not null then
    raise exception 'FORBIDDEN' using hint = 'This function is server-side only.';
  end if;

  if exists (select 1 from public.profiles p where p.role = 'admin') then
    raise exception 'ADMIN_ALREADY_EXISTS';
  end if;

  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_digits !~ '^[1-9][0-9]{6,14}$' then
    raise exception 'INVALID_PHONE';
  end if;

  select count(*), min(m.id)
  into v_count, v_id
  from public.phone_email_map m
  where regexp_replace(m.phone, '[^0-9]', '', 'g') = v_digits;

  if v_count = 0 then
    select count(*), min(u.id)
    into v_count, v_id
    from auth.users u
    where regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = v_digits;
  end if;

  if v_count = 0 then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_count > 1 then
    raise exception 'PHONE_AMBIGUOUS';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_id
  for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if v_profile.role not in ('player', 'user')
     or v_profile.status not in ('pending', 'approved') then
    raise exception 'PROFILE_NOT_BOOTSTRAPPABLE';
  end if;

  update public.profiles
  set role = 'admin',
      status = 'approved',
      approved_at = now(),
      approved_by = null,
      rejection_reason = null
  where id = v_id;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values (v_id, 'system', 'admin_bootstrapped', 'profile', v_id::text,
          jsonb_build_object('phone_last4', right(v_digits, 4)));

  return v_id;
end;
$$;

revoke all on function public.bootstrap_first_admin(text) from public;
revoke all on function public.bootstrap_first_admin(text) from anon;
revoke all on function public.bootstrap_first_admin(text) from authenticated;
grant execute on function public.bootstrap_first_admin(text) to service_role;
