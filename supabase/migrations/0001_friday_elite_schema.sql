-- ============================================================================
-- Friday Elite — Initial schema (Migration 0001)
-- Target: Supabase (PostgreSQL 15+)
-- Timezone: Asia/Jerusalem (all timestamps stored as timestamptz / UTC)
--
-- STATUS: DRAFT — DO NOT EXECUTE WITHOUT REVIEW APPROVAL.
--
-- Design rules enforced here:
--   * Every football action is authorized inside the database, never in React.
--   * Registration / cancellation / promotion state transitions live in
--     SECURITY DEFINER functions with a fixed empty search_path.
--   * Clients never receive INSERT/UPDATE/DELETE on matches, registrations,
--     team tables, notifications or audit_log. They only call RPCs.
-- ============================================================================

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- group_settings — singleton row (id is always TRUE)
-- ---------------------------------------------------------------------------
create table if not exists public.group_settings (
  id              boolean primary key default true,
  group_name      text not null default 'Friday Elite',
  timezone        text not null default 'Asia/Jerusalem',
  capacity        smallint not null default 18 check (capacity between 2 and 18),
  team_size       smallint not null default 9 check (team_size between 2 and 9),
  formation       text not null default '1-3-3-2' check (formation = '1-3-3-2'),
  team_a_name     text not null default 'الفريق الأخضر',
  team_b_name     text not null default 'الفريق الأبيض',
  team_a_color    text not null default '#d2ff4d',
  team_b_color    text not null default '#f5f3ea',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint group_settings_singleton check (id),
  constraint group_settings_timezone check (timezone = 'Asia/Jerusalem')
);

-- ---------------------------------------------------------------------------
-- positions — football position lookup
-- ---------------------------------------------------------------------------
create table if not exists public.positions (
  code        text primary key,
  name_ar     text not null,
  name_en     text not null,
  category    text not null check (category in ('gk', 'defense', 'midfield', 'attack')),
  sort_order  smallint not null default 0,
  is_active   boolean not null default true
);

-- ---------------------------------------------------------------------------
-- profiles — one row per auth.users row, created by trigger as "pending"
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text not null,
  phone             text not null,
  avatar_url        text,
  role              text not null default 'player' check (role in ('admin', 'player')),
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected', 'suspended')),
  skill_level       smallint check (skill_level is null or skill_level between 1 and 5),
  preferred_foot    text check (preferred_foot is null or preferred_foot in ('right', 'left', 'both')),
  jersey_number     smallint check (jersey_number is null or jersey_number between 1 and 99),
  approved_at       timestamptz,
  approved_by       uuid references public.profiles (id) on delete set null,
  rejection_reason  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_name_len check (char_length(btrim(full_name)) between 2 and 80),
  constraint profiles_phone_fmt check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint profiles_approved_consistency check (status <> 'approved' or approved_at is not null)
);

create index if not exists profiles_status_idx on public.profiles (status, role);

-- The Auth layer also enforces phone uniqueness. This index is the application
-- data-integrity backstop and prevents duplicate normalized profile phones.
create unique index if not exists profiles_phone_uidx
  on public.profiles (phone);

-- One shirt number per approved player.
create unique index if not exists profiles_unique_jersey
  on public.profiles (jersey_number)
  where jersey_number is not null and status = 'approved';

-- ---------------------------------------------------------------------------
-- player_positions — ranked preferences (priority 1 = first choice)
-- ---------------------------------------------------------------------------
create table if not exists public.player_positions (
  player_id      uuid not null references public.profiles (id) on delete cascade,
  position_code  text not null references public.positions (code) on update cascade on delete restrict,
  priority       smallint not null check (priority between 1 and 5),
  created_at     timestamptz not null default now(),
  primary key (player_id, position_code),
  constraint player_positions_unique_priority unique (player_id, priority)
);

create index if not exists player_positions_player_idx
  on public.player_positions (player_id, priority);

-- ---------------------------------------------------------------------------
-- matches — one weekly match. Schedule columns are derived by trigger.
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id                     uuid primary key default gen_random_uuid(),
  kickoff_at             timestamptz not null,
  registration_open_at   timestamptz not null,
  registration_close_at  timestamptz not null,
  local_date             date not null,
  venue                  text not null check (char_length(btrim(venue)) between 2 and 120),
  address                text,
  notes                  text,
  capacity               smallint not null default 18 check (capacity between 2 and 18),
  team_size              smallint not null default 9 check (team_size between 2 and 9),
  formation              text not null default '1-3-3-2' check (formation = '1-3-3-2'),
  status                 text not null default 'scheduled'
                           check (status in ('draft', 'scheduled', 'registration_open',
                                             'registration_closed', 'teams_published',
                                             'completed', 'cancelled')),
  registration_locked    boolean not null default false,
  teams_stale            boolean not null default false,
  teams_generated_at     timestamptz,
  teams_generated_by     uuid references public.profiles (id) on delete set null,
  teams_seed             text,
  teams_cost             numeric(10, 3),
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint matches_window check (registration_open_at < registration_close_at),
  constraint matches_close_by_kickoff check (registration_close_at <= kickoff_at),
  constraint matches_teams_meta check (
    (teams_generated_at is null and teams_seed is null)
    or (teams_generated_at is not null and teams_seed is not null)
  )
);

create unique index if not exists matches_local_date_uidx
  on public.matches (local_date);
create index if not exists matches_status_idx
  on public.matches (status, kickoff_at);

-- ---------------------------------------------------------------------------
-- registrations — confirmed / waitlisted / cancelled, FIFO by queue_position
-- queue_position is never reused or renumbered after creation.
--
-- roster_role is a snapshot assigned when the row becomes confirmed:
--   * 'gk'      — one of the two goalkeeper roles
--   * 'outfield'— one of the sixteen outfield roles
-- Waitlisted rows have NULL. Cancelled rows retain the historical role.
-- ---------------------------------------------------------------------------
create table if not exists public.registrations (
  id             uuid primary key default gen_random_uuid(),
  match_id       uuid not null references public.matches (id) on delete restrict,
  player_id      uuid not null references public.profiles (id) on delete restrict,
  status         text not null default 'waitlisted'
                   check (status in ('confirmed', 'waitlisted', 'cancelled')),
  roster_role    text,
  queue_position integer not null check (queue_position > 0),
  registered_at  timestamptz not null default now(),
  confirmed_at   timestamptz,
  promoted_at    timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   uuid references public.profiles (id) on delete set null,
  source         text not null default 'self' check (source in ('self', 'admin')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint registrations_unique_queue unique (match_id, queue_position),
  constraint registrations_roster_role_check
    check (roster_role is null or roster_role in ('gk', 'outfield')),
  constraint registrations_role_consistency check (
    (status = 'confirmed' and roster_role is not null)
    or (status = 'waitlisted' and roster_role is null)
    or status = 'cancelled'
  ),
  constraint registrations_confirmed_time check (status <> 'confirmed' or confirmed_at is not null),
  constraint registrations_cancelled_time check (status <> 'cancelled' or cancelled_at is not null)
);

-- No duplicate active registration, but allow a new one after cancelling.
create unique index if not exists registrations_one_active_per_player
  on public.registrations (match_id, player_id)
  where status <> 'cancelled';
create index if not exists registrations_match_status_queue_idx
  on public.registrations (match_id, status, queue_position);
create index if not exists registrations_match_confirmed_role_idx
  on public.registrations (match_id, roster_role)
  where status = 'confirmed';
create index if not exists registrations_player_idx
  on public.registrations (player_id, registered_at desc);

-- ---------------------------------------------------------------------------
-- match_teams — exactly two rows per generated match (A / B)
-- ---------------------------------------------------------------------------
create table if not exists public.match_teams (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches (id) on delete cascade,
  side        text not null check (side in ('A', 'B')),
  name_ar     text not null,
  color       text,
  formation   text not null default '1-3-3-2' check (formation = '1-3-3-2'),
  created_at  timestamptz not null default now(),
  constraint match_teams_side_uq unique (match_id, side),
  constraint match_teams_id_match_uq unique (id, match_id)
);

-- ---------------------------------------------------------------------------
-- team_assignments — one row per confirmed player after the draw
-- ---------------------------------------------------------------------------
create table if not exists public.team_assignments (
  id                     uuid primary key default gen_random_uuid(),
  match_id               uuid not null references public.matches (id) on delete cascade,
  team_id                uuid not null,
  player_id              uuid not null references public.profiles (id) on delete restrict,
  assigned_position_code text not null references public.positions (code) on update cascade,
  slot_index             smallint not null default 0,
  is_out_of_position     boolean not null default false,
  created_at             timestamptz not null default now(),
  constraint team_assignments_team_match_fk
    foreign key (team_id, match_id) references public.match_teams (id, match_id) on delete cascade,
  constraint team_assignments_one_team_uq unique (match_id, player_id),
  constraint team_assignments_team_uq unique (team_id, player_id)
);

create index if not exists team_assignments_team_idx on public.team_assignments (team_id);
create index if not exists team_assignments_player_idx on public.team_assignments (player_id);

-- ---------------------------------------------------------------------------
-- notifications — in-app feed (written only by SECURITY DEFINER functions)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.profiles (id) on delete cascade,
  match_id    uuid references public.matches (id) on delete set null,
  type        text not null check (type in (
                'account_approved', 'account_rejected', 'account_suspended',
                'registration_confirmed', 'registration_waitlisted',
                'registration_cancelled', 'registration_promoted',
                'teams_published', 'teams_stale',
                'match_created', 'match_cancelled')),
  title_ar    text not null,
  body_ar     text,
  metadata    jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_player_idx
  on public.notifications (player_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (player_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- audit_log — append-only trail (no UPDATE/DELETE policies or grants)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_role  text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  match_id    uuid references public.matches (id) on delete set null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_match_idx on public.audit_log (match_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);

-- ============================================================================
-- 2. GENERIC TRIGGERS
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists matches_set_updated_at on public.matches;
create trigger matches_set_updated_at
  before update on public.matches
  for each row execute function public.set_updated_at();

drop trigger if exists registrations_set_updated_at on public.registrations;
create trigger registrations_set_updated_at
  before update on public.registrations
  for each row execute function public.set_updated_at();

drop trigger if exists group_settings_set_updated_at on public.group_settings;
create trigger group_settings_set_updated_at
  before update on public.group_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auth -> profile provisioning. Phone is the login identifier, so it is
-- required. Supabase Auth strips the leading "+" when storing auth.users.phone;
-- the profile always stores normalized E.164. Role/status are hardcoded.
-- ---------------------------------------------------------------------------
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
  v_name  := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
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
  values (new.id, v_name, v_phone, 'player', 'pending')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Auth phone-change guard. Normal players cannot change their login phone
-- through the Auth API because a phone change must be a controlled admin
-- operation. A controlled operation sets app.allow_phone_change = 'true' for
-- the transaction. The profile phone is then synchronized; a player is moved
-- back to pending, their future active registrations are cancelled, and the
-- waiting list is promoted. Admin phone changes keep approval.
-- ---------------------------------------------------------------------------
create or replace function public.handle_user_phone_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone      text;
  v_role       text;
  v_match_id   uuid;
begin
  if current_setting('app.allow_phone_change', true) is distinct from 'true' then
    raise exception 'PHONE_CHANGE_REQUIRES_ADMIN'
      using hint = 'Phone changes must use the controlled admin process.';
  end if;

  v_phone := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');
  if v_phone !~ '^[1-9][0-9]{6,14}$' then
    raise exception 'PHONE_REQUIRED'
      using hint = 'A valid international phone number is required.';
  end if;
  v_phone := left('+' || v_phone, 16);

  select p.role into v_role
  from public.profiles p
  where p.id = new.id;

  if v_role is null then
    return new;
  end if;

  update public.profiles
  set phone = v_phone,
      status = case when v_role = 'admin' then status else 'pending' end,
      approved_at = case when v_role = 'admin' then approved_at else null end,
      approved_by = case when v_role = 'admin' then approved_by else null end,
      rejection_reason = case when v_role = 'admin' then rejection_reason else null end
  where id = new.id;

  if v_role <> 'admin' then
    -- A phone change invalidates approval, so release future match places.
    -- Match rows are locked first to match cancel_registration's lock order.
    for v_match_id in
      select distinct m.id
      from public.matches m
      join public.registrations r on r.match_id = m.id
      where r.player_id = new.id
        and r.status <> 'cancelled'
        and m.status not in ('completed', 'cancelled')
        and m.kickoff_at > now()
      order by m.id
    loop
      perform 1 from public.matches where id = v_match_id for update;

      update public.registrations
      set status = 'cancelled',
          cancelled_at = now(),
          cancelled_by = new.id
      where match_id = v_match_id
        and player_id = new.id
        and status <> 'cancelled';

      insert into public.audit_log
        (actor_id, actor_role, action, entity, entity_id, match_id, payload)
      values
        (new.id, v_role, 'registration_cancelled_phone_change', 'registration',
         new.id::text, v_match_id, jsonb_build_object('reason', 'phone_changed'));

      update public.matches
      set teams_stale = true,
          status = case when status = 'teams_published' then 'registration_closed' else status end
      where id = v_match_id
        and exists (select 1 from public.match_teams t where t.match_id = v_match_id);

      perform public.promote_waitlist(v_match_id);
    end loop;
  end if;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values (new.id, v_role, 'auth_phone_changed', 'profile', new.id::text,
          jsonb_build_object('reapproval_required', v_role <> 'admin',
                             'phone_last4', right(v_phone, 4)));

  return new;
end;
$$;

drop trigger if exists on_auth_user_phone_changed on auth.users;
create trigger on_auth_user_phone_changed
  after update of phone on auth.users
  for each row
  when (old.phone is distinct from new.phone)
  execute function public.handle_user_phone_change();

-- ---------------------------------------------------------------------------
-- Match schedule: Friday 20:00 local, registration Thursday 10:00 local.
-- The trigger always overwrites these fields, so clients cannot forge them.
-- ---------------------------------------------------------------------------
create or replace function public.set_match_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_local timestamp;
begin
  select coalesce(g.timezone, 'Asia/Jerusalem') into v_tz
  from public.group_settings g
  where g.id;

  v_tz := coalesce(v_tz, 'Asia/Jerusalem');
  v_local := new.kickoff_at at time zone v_tz;

  if extract(isodow from v_local) <> 5 then
    raise exception 'MATCH_DAY_INVALID' using hint = 'Kickoff must be on a Friday.';
  end if;
  if v_local::time <> time '20:00' then
    raise exception 'MATCH_TIME_INVALID' using hint = 'Kickoff must be at 20:00 local time.';
  end if;

  new.local_date := v_local::date;
  new.registration_open_at  := ((v_local::date - 1) + time '10:00') at time zone v_tz;
  new.registration_close_at := new.kickoff_at;

  return new;
end;
$$;

drop trigger if exists matches_set_schedule on public.matches;
drop trigger if exists matches_set_schedule_update on public.matches;

create trigger matches_set_schedule
  before insert on public.matches
  for each row execute function public.set_match_schedule();

create trigger matches_set_schedule_update
  before update of kickoff_at on public.matches
  for each row
  when (old.kickoff_at is distinct from new.kickoff_at)
  execute function public.set_match_schedule();

-- ============================================================================
-- 3. AUTHORIZATION HELPERS (SECURITY DEFINER, fixed search_path, no recursion)
-- ============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.status = 'approved'
  );
$$;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'approved'
  );
$$;

create or replace function public.can_manage_own_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status in ('pending', 'approved')
  );
$$;

create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using hint = 'Admin privileges are required.';
  end if;
end;
$$;

-- Internal helper: fan out a notification to every approved admin.
create or replace function public.notify_admins(
  p_match_id uuid,
  p_type     text,
  p_title    text,
  p_body     text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (player_id, match_id, type, title_ar, body_ar)
  select p.id, p_match_id, p_type, p_title, p_body
  from public.profiles p
  where p.role = 'admin' and p.status = 'approved';
$$;

-- ============================================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles         enable row level security;
alter table public.positions        enable row level security;
alter table public.player_positions enable row level security;
alter table public.matches          enable row level security;
alter table public.registrations    enable row level security;
alter table public.match_teams      enable row level security;
alter table public.team_assignments enable row level security;
alter table public.notifications    enable row level security;
alter table public.audit_log        enable row level security;
alter table public.group_settings   enable row level security;

-- --------------------------- profiles -------------------------------------
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

-- Profile UPDATE is intentionally NOT granted on the table.
-- Players update via update_my_profile(); admins via admin RPCs.

-- --------------------------- positions ------------------------------------
drop policy if exists positions_read on public.positions;
create policy positions_read
  on public.positions for select to authenticated
  using (true);

-- ------------------------ player_positions --------------------------------
drop policy if exists player_positions_read on public.player_positions;
create policy player_positions_read
  on public.player_positions for select to authenticated
  using (player_id = (select auth.uid()) or public.is_approved() or public.is_admin());

drop policy if exists player_positions_insert_own on public.player_positions;
create policy player_positions_insert_own
  on public.player_positions for insert to authenticated
  with check (player_id = (select auth.uid()) and public.can_manage_own_profile());

drop policy if exists player_positions_update_own on public.player_positions;
create policy player_positions_update_own
  on public.player_positions for update to authenticated
  using (player_id = (select auth.uid()) and public.can_manage_own_profile())
  with check (player_id = (select auth.uid()) and public.can_manage_own_profile());

drop policy if exists player_positions_delete_own on public.player_positions;
create policy player_positions_delete_own
  on public.player_positions for delete to authenticated
  using (player_id = (select auth.uid()) and public.can_manage_own_profile());

-- ----------------------------- matches ------------------------------------
drop policy if exists matches_read on public.matches;
create policy matches_read
  on public.matches for select to authenticated
  using (
    public.is_admin()
    or (public.is_approved() and status <> 'draft')
  );

-- No write policies: all match writes go through admin RPCs.

-- -------------------------- registrations ---------------------------------
drop policy if exists registrations_read on public.registrations;
create policy registrations_read
  on public.registrations for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_approved()
      and exists (
        select 1 from public.matches m
        where m.id = match_id and m.status <> 'draft'
      )
    )
  );

-- No write policies: register/cancel/promote are RPC-only.

-- --------------------------- match_teams ----------------------------------
drop policy if exists match_teams_read on public.match_teams;
create policy match_teams_read
  on public.match_teams for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_approved()
      and exists (
        select 1 from public.matches m
        where m.id = match_id and m.status in ('teams_published', 'completed')
      )
    )
  );

-- ------------------------- team_assignments -------------------------------
drop policy if exists team_assignments_read on public.team_assignments;
create policy team_assignments_read
  on public.team_assignments for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_approved()
      and exists (
        select 1 from public.matches m
        where m.id = match_id and m.status in ('teams_published', 'completed')
      )
    )
  );

-- --------------------------- notifications --------------------------------
drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own
  on public.notifications for select to authenticated
  using (player_id = (select auth.uid()) or public.is_admin());

drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read
  on public.notifications for update to authenticated
  using (player_id = (select auth.uid()))
  with check (player_id = (select auth.uid()));

-- ----------------------------- audit_log ----------------------------------
drop policy if exists audit_log_read_admin on public.audit_log;
create policy audit_log_read_admin
  on public.audit_log for select to authenticated
  using (public.is_admin());

-- --------------------------- group_settings -------------------------------
drop policy if exists group_settings_read on public.group_settings;
create policy group_settings_read
  on public.group_settings for select to authenticated
  using (public.is_admin() or public.is_approved());

drop policy if exists group_settings_update_admin on public.group_settings;
create policy group_settings_update_admin
  on public.group_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- 5. TABLE PRIVILEGES (explicit, least privilege)
-- ============================================================================

revoke all on table
  public.profiles, public.positions, public.player_positions, public.matches,
  public.registrations, public.match_teams, public.team_assignments,
  public.notifications, public.audit_log, public.group_settings
from anon, authenticated;

grant select on table public.profiles         to authenticated;
grant select on table public.positions        to authenticated;
grant select on table public.matches          to authenticated;
grant select on table public.registrations    to authenticated;
grant select on table public.match_teams      to authenticated;
grant select on table public.team_assignments to authenticated;
grant select on table public.notifications    to authenticated;
grant select on table public.audit_log        to authenticated;
grant select on table public.group_settings   to authenticated;

-- Only editable user-owned table, constrained by RLS to the caller's rows.
grant select, insert, update, delete on table public.player_positions to authenticated;

-- Players may only mark their own notifications as read.
grant update (read_at) on table public.notifications to authenticated;

-- Admins may tune settings; constrained by RLS.
grant update (group_name, timezone, capacity, team_size, formation,
              team_a_name, team_b_name, team_a_color, team_b_color)
  on table public.group_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Safe public directory. Profiles are otherwise private (phone, status, role),
-- but teammates need names for rosters. The view exposes only approved players
-- and only non-sensitive columns, and is owned by the migration role.
-- ---------------------------------------------------------------------------
create or replace view public.player_directory as
select p.id,
       p.full_name,
       p.avatar_url,
       p.jersey_number,
       p.preferred_foot
from public.profiles p
where p.status = 'approved'
  and public.is_approved();

revoke all on public.player_directory from anon, authenticated;
grant select on public.player_directory to authenticated;

-- ============================================================================
-- 6. FUNCTIONS — PLAYER SELF-SERVICE
-- ============================================================================

-- Replaces the caller's editable profile fields. Null clears optional fields.
-- Phone is intentionally not editable here: it is synchronized from Auth only.
create or replace function public.update_my_profile(
  p_full_name      text,
  p_avatar_url     text,
  p_preferred_foot text,
  p_jersey_number  smallint
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if not public.can_manage_own_profile() then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  if p_full_name is null or char_length(btrim(p_full_name)) < 2 then
    raise exception 'INVALID_NAME';
  end if;

  if p_preferred_foot is not null and p_preferred_foot not in ('right', 'left', 'both') then
    raise exception 'INVALID_PREFERRED_FOOT';
  end if;

  if p_jersey_number is not null and (p_jersey_number < 1 or p_jersey_number > 99) then
    raise exception 'INVALID_JERSEY_NUMBER';
  end if;

  update public.profiles
  set full_name      = left(btrim(p_full_name), 80),
      avatar_url     = nullif(btrim(p_avatar_url), ''),
      preferred_foot = p_preferred_foot,
      jersey_number  = p_jersey_number
  where id = v_uid
  returning * into v_row;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values (v_uid, 'player', 'profile_updated', 'profile', v_uid::text,
          jsonb_build_object('jersey_number', p_jersey_number,
                             'preferred_foot', p_preferred_foot));

  return v_row;
end;
$$;

-- Atomically replaces the caller's ordered position preferences.
create or replace function public.set_my_positions(p_position_codes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_code text;
  v_seen text[] := '{}';
  v_i    integer := 0;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if not public.can_manage_own_profile() then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  if p_position_codes is null
     or array_length(p_position_codes, 1) is null
     or array_length(p_position_codes, 1) = 0 then
    raise exception 'POSITIONS_REQUIRED';
  end if;

  if array_length(p_position_codes, 1) > 5 then
    raise exception 'TOO_MANY_POSITIONS';
  end if;

  foreach v_code in array p_position_codes loop
    v_code := btrim(v_code);
    if not exists (select 1 from public.positions pos where pos.code = v_code and pos.is_active) then
      raise exception 'INVALID_POSITION' using hint = v_code;
    end if;
    if v_code = any (v_seen) then
      raise exception 'DUPLICATE_POSITION' using hint = v_code;
    end if;
    v_seen := v_seen || v_code;
  end loop;

  delete from public.player_positions where player_id = v_uid;

  foreach v_code in array p_position_codes loop
    v_i := v_i + 1;
    insert into public.player_positions (player_id, position_code, priority)
    values (v_uid, btrim(v_code), v_i);
  end loop;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values (v_uid, 'player', 'positions_updated', 'profile', v_uid::text,
          jsonb_build_object('positions', to_jsonb(p_position_codes)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal roster composition helpers (SECURITY DEFINER, revoked from clients)
-- ---------------------------------------------------------------------------

-- Classify a player from their saved positions. A player who saved GK plus at
-- least one outfield position is "gk_and_outfield"; a player with no saved
-- positions is treated as outfield.
create or replace function public.player_roster_class(p_player_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when count(*) filter (where pos.category = 'gk') > 0
     and count(*) filter (where pos.category <> 'gk') > 0 then 'gk_and_outfield'
    when count(*) filter (where pos.category = 'gk') > 0 then 'gk_only'
    else 'outfield'
  end
  from public.player_positions pp
  join public.positions pos on pos.code = pp.position_code
  where pp.player_id = p_player_id;
$$;

-- Current confirmed composition for one match.
create or replace function public.roster_counts(p_match_id uuid)
returns table (gk integer, outfield integer)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) filter (where r.roster_role = 'gk')::integer,
         count(*) filter (where r.roster_role = 'outfield')::integer
  from public.registrations r
  where r.match_id = p_match_id
    and r.status = 'confirmed';
$$;

-- Single source of truth for the approved composition matrix. Returns exactly
-- one row; eligible=false means the player must wait (or stay waiting).
create or replace function public.roster_eligibility(
  p_match_id  uuid,
  p_player_id uuid,
  out eligible boolean,
  out roster_role text
)
returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
  v_gk       integer;
  v_outfield integer;
  v_class    text;
  v_eligible boolean;
  v_role     text;
begin
  select m.capacity into v_capacity
  from public.matches m
  where m.id = p_match_id;

  if v_capacity is null then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  select rc.gk, rc.outfield into v_gk, v_outfield
  from public.roster_counts(p_match_id) rc;

  v_class := public.player_roster_class(p_player_id);

  if v_gk + v_outfield >= v_capacity then
    v_eligible := false;
    v_role := null;
  elsif v_outfield >= 16 and v_gk < 2 then
    -- The 16 outfield seats are full but a goalkeeper seat is open.
    if v_class in ('gk_only', 'gk_and_outfield') then
      v_eligible := true;
      v_role := 'gk';
    else
      v_eligible := false;
      v_role := null;
    end if;
  elsif v_gk >= 2 and v_class = 'gk_only' then
    -- A GK-only player can never take an outfield seat.
    v_eligible := false;
    v_role := null;
  else
    v_eligible := true;
    if v_gk < 2 and v_class in ('gk_only', 'gk_and_outfield') then
      v_role := 'gk';
    else
      v_role := 'outfield';
    end if;
  end if;

  eligible := v_eligible;
  roster_role := v_role;
  return;
end;
$$;

-- Promote every waitlisted player who is currently eligible, in FIFO order.
-- Ineligible entries are left untouched and keep their queue_position.
create or replace function public.promote_waitlist(p_match_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_capacity   integer;
  v_gk         integer;
  v_outfield   integer;
  v_class      text;
  v_role       text;
  v_next       public.registrations%rowtype;
  v_actor      uuid := (select auth.uid());
  v_actor_role text;
  v_promoted   integer := 0;
  v_i          integer;
begin
  -- Lock order is always: match row first, then registration rows.
  select m.capacity into v_capacity
  from public.matches m
  where m.id = p_match_id
  for update;

  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  v_actor_role := case
    when v_actor is null then 'system'
    when public.is_admin() then 'admin'
    else 'player'
  end;

  -- One iteration per potentially promotable seat. The loop exits as soon as
  -- the roster is full or no eligible waitlister remains.
  for v_i in 1 .. v_capacity loop
    select rc.gk, rc.outfield into v_gk, v_outfield
    from public.roster_counts(p_match_id) rc;

    exit when v_gk + v_outfield >= v_capacity;

    if v_outfield >= 16 and v_gk < 2 then
      -- Outfield is full and a goalkeeper seat is open: GK-eligible only.
      select r.* into v_next
      from public.registrations r
      join public.profiles p on p.id = r.player_id
      where r.match_id = p_match_id
        and r.status = 'waitlisted'
        and p.status = 'approved'
        and public.player_roster_class(r.player_id) in ('gk_only', 'gk_and_outfield')
      order by r.queue_position
      limit 1
      for update of r;
    else
      -- While outfield < 16 every class may be confirmed. Once both GK roles
      -- exist, a GK-only player cannot be given an outfield role.
      select r.* into v_next
      from public.registrations r
      join public.profiles p on p.id = r.player_id
      where r.match_id = p_match_id
        and r.status = 'waitlisted'
        and p.status = 'approved'
        and not (v_gk >= 2 and public.player_roster_class(r.player_id) = 'gk_only')
      order by r.queue_position
      limit 1
      for update of r;
    end if;

    exit when not found;

    v_class := public.player_roster_class(v_next.player_id);

    if v_gk < 2 and v_class in ('gk_only', 'gk_and_outfield') then
      v_role := 'gk';
    else
      v_role := 'outfield';
    end if;

    update public.registrations
    set status = 'confirmed',
        confirmed_at = now(),
        promoted_at = now(),
        roster_role = v_role
    where id = v_next.id
    returning * into v_next;

    insert into public.notifications (player_id, match_id, type, title_ar, body_ar, metadata)
    values (
      v_next.player_id, p_match_id, 'registration_promoted',
      'تمت ترقيتك إلى قائمة المؤكدين',
      case when v_role = 'gk'
           then 'توفّر مقعد، وأصبح تسجيلك مؤكدًا كحارس مرمى. نراك يوم الجمعة.'
           else 'توفّر مقعد، وأصبح تسجيلك مؤكدًا. نراك يوم الجمعة.' end,
      jsonb_build_object('queue_position', v_next.queue_position,
                         'roster_role', v_role)
    );

    insert into public.audit_log
      (actor_id, actor_role, action, entity, entity_id, match_id, payload)
    values
      (v_actor, v_actor_role, 'registration_promoted', 'registration',
       v_next.id::text, p_match_id,
       jsonb_build_object('promoted_player', v_next.player_id,
                          'queue_position', v_next.queue_position,
                          'roster_role', v_role));

    v_promoted := v_promoted + 1;
  end loop;

  return v_promoted;
end;
$$;

-- ============================================================================
-- 7. FUNCTIONS — REGISTRATION & WAITING LIST
-- ============================================================================

-- Atomic registration: locks the match row, so capacity checks and queue
-- numbering cannot race. Capacity is enforced against the locked row.
create or replace function public.register_for_match(p_match_id uuid)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_match    public.matches%rowtype;
  v_eligible boolean;
  v_role     text;
  v_pos      integer;
  v_status   text;
  v_reg      public.registrations%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  -- Account approval gate (checked on the server, not in React).
  if not public.is_approved() then
    raise exception 'ACCOUNT_NOT_APPROVED'
      using hint = 'Your account must be approved by an administrator.';
  end if;

  -- Serialize every registration/cancellation for this match.
  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  if v_match.status not in ('scheduled', 'registration_open') then
    raise exception 'REGISTRATION_CLOSED';
  end if;
  if v_match.registration_locked then
    raise exception 'REGISTRATION_LOCKED';
  end if;
  if now() < v_match.registration_open_at then
    raise exception 'REGISTRATION_NOT_OPEN';
  end if;
  if now() >= v_match.registration_close_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  if exists (
    select 1 from public.registrations r
    where r.match_id = p_match_id
      and r.player_id = v_uid
      and r.status <> 'cancelled'
  ) then
    raise exception 'ALREADY_REGISTERED';
  end if;

  select e.eligible, e.roster_role into v_eligible, v_role
  from public.roster_eligibility(p_match_id, v_uid) e;

  select coalesce(max(r.queue_position), 0) + 1 into v_pos
  from public.registrations r
  where r.match_id = p_match_id;

  if v_eligible then
    v_status := 'confirmed';
  else
    v_status := 'waitlisted';
    v_role := null;
  end if;

  insert into public.registrations
    (match_id, player_id, status, queue_position, roster_role, confirmed_at, source)
  values
    (p_match_id, v_uid, v_status, v_pos,
     case when v_status = 'confirmed' then v_role else null end,
     case when v_status = 'confirmed' then now() else null end,
     'self')
  returning * into v_reg;

  if v_match.status = 'scheduled' then
    update public.matches set status = 'registration_open'
    where id = p_match_id and status = 'scheduled';
  end if;

  insert into public.notifications (player_id, match_id, type, title_ar, body_ar, metadata)
  values (
    v_uid, p_match_id,
    case when v_status = 'confirmed' then 'registration_confirmed' else 'registration_waitlisted' end,
    case when v_status = 'confirmed' then 'تم تأكيد مقعدك' else 'أنت في قائمة الانتظار' end,
    case when v_status = 'confirmed'
         then 'تم تسجيلك في المباراة. نراك يوم الجمعة.'
         else 'اكتمل العدد، وسيتم ترقيتك تلقائيًا عند توفر مقعد.' end,
    jsonb_build_object('queue_position', v_pos, 'status', v_status,
                       'roster_role', v_reg.roster_role)
  );

  insert into public.audit_log
    (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values
    (v_uid, 'player', 'registration_created', 'registration', v_reg.id::text, p_match_id,
     jsonb_build_object('status', v_status, 'queue_position', v_pos,
                        'roster_role', v_reg.roster_role));

  -- A new confirmed player can change the composition; re-evaluate the
  -- waiting list in the same transaction.
  perform public.promote_waitlist(p_match_id);

  return v_reg;
end;
$$;

-- Cancel (player or admin) + FIFO promotion, all inside one transaction.
create or replace function public.cancel_registration(p_registration_id uuid)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_is_admin     boolean := public.is_admin();
  v_match_id     uuid;
  v_match        public.matches%rowtype;
  v_reg          public.registrations%rowtype;
  v_was_confirmed boolean;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  -- Ordinary players must still be approved to touch player functionality.
  -- Admins retain the ability to cancel on behalf of a suspended player.
  if not v_is_admin and not public.is_approved() then
    raise exception 'ACCOUNT_NOT_APPROVED'
      using hint = 'Your account must be approved by an administrator.';
  end if;

  select r.match_id into v_match_id
  from public.registrations r
  where r.id = p_registration_id;

  if not found then
    raise exception 'REGISTRATION_NOT_FOUND';
  end if;

  -- Lock order: match row first, then registration row (same order as register).
  select * into v_match
  from public.matches
  where id = v_match_id
  for update;

  select * into v_reg
  from public.registrations
  where id = p_registration_id
  for update;

  if v_reg.player_id <> v_uid and not v_is_admin then
    raise exception 'FORBIDDEN';
  end if;
  if v_reg.status = 'cancelled' then
    raise exception 'ALREADY_CANCELLED';
  end if;
  if v_match.status in ('completed', 'cancelled') then
    raise exception 'MATCH_CLOSED';
  end if;
  if not v_is_admin and now() >= v_match.kickoff_at then
    raise exception 'CANCELLATION_CLOSED';
  end if;

  v_was_confirmed := (v_reg.status = 'confirmed');

  update public.registrations
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_uid
  where id = p_registration_id
  returning * into v_reg;

  insert into public.audit_log
    (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values
    (v_uid, case when v_is_admin then 'admin' else 'player' end,
     'registration_cancelled', 'registration', v_reg.id::text, v_match_id,
     jsonb_build_object('was_confirmed', v_was_confirmed,
                        'queue_position', v_reg.queue_position,
                        'roster_role', v_reg.roster_role));

  if v_was_confirmed then
    -- Re-evaluate the whole waiting list. The sweep may promote more than one
    -- player and preserves FIFO among currently eligible entries.
    perform public.promote_waitlist(v_match_id);

    -- Any roster change after the draw invalidates the published teams.
    if exists (select 1 from public.match_teams t where t.match_id = v_match_id) then
      update public.matches
      set teams_stale = true,
          status = case when status = 'teams_published' then 'registration_closed' else status end
      where id = v_match_id;

      perform public.notify_admins(
        v_match_id,
        'teams_stale',
        'تغيّرت قائمة اللاعبين',
        'تم إلغاء تسجيل مؤكد بعد نشر الفرق. أعد توليد الفرق قبل المباراة.'
      );
    end if;
  end if;

  return v_reg;
end;
$$;

-- Admin-only: add an approved player (bypasses the public time window,
-- still respects capacity and FIFO numbering).
create or replace function public.admin_add_registration(
  p_match_id  uuid,
  p_player_id uuid
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match    public.matches%rowtype;
  v_player   public.profiles%rowtype;
  v_eligible boolean;
  v_role     text;
  v_pos      integer;
  v_status   text;
  v_reg      public.registrations%rowtype;
begin
  perform public.assert_admin();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status in ('cancelled', 'completed') then
    raise exception 'MATCH_CLOSED';
  end if;

  select * into v_player from public.profiles where id = p_player_id;
  if not found or v_player.status <> 'approved' then
    raise exception 'PLAYER_NOT_APPROVED';
  end if;

  if exists (
    select 1 from public.registrations r
    where r.match_id = p_match_id and r.player_id = p_player_id and r.status <> 'cancelled'
  ) then
    raise exception 'ALREADY_REGISTERED';
  end if;

  select e.eligible, e.roster_role into v_eligible, v_role
  from public.roster_eligibility(p_match_id, p_player_id) e;

  select coalesce(max(r.queue_position), 0) + 1 into v_pos
  from public.registrations r
  where r.match_id = p_match_id;

  if v_eligible then
    v_status := 'confirmed';
  else
    v_status := 'waitlisted';
    v_role := null;
  end if;

  insert into public.registrations
    (match_id, player_id, status, queue_position, roster_role, confirmed_at, source)
  values
    (p_match_id, p_player_id, v_status, v_pos,
     case when v_status = 'confirmed' then v_role else null end,
     case when v_status = 'confirmed' then now() else null end,
     'admin')
  returning * into v_reg;

  insert into public.notifications (player_id, match_id, type, title_ar, body_ar, metadata)
  values (
    p_player_id, p_match_id,
    case when v_status = 'confirmed' then 'registration_confirmed' else 'registration_waitlisted' end,
    case when v_status = 'confirmed' then 'تم تسجيلك في المباراة' else 'تمت إضافتك لقائمة الانتظار' end,
    'أضافك مدير المجموعة إلى المباراة.',
    jsonb_build_object('queue_position', v_pos, 'status', v_status,
                       'source', 'admin', 'roster_role', v_reg.roster_role)
  );

  if exists (select 1 from public.match_teams t where t.match_id = p_match_id) then
    update public.matches set teams_stale = true where id = p_match_id;
  end if;

  insert into public.audit_log
    (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values
    ((select auth.uid()), 'admin', 'registration_added_by_admin', 'registration',
     v_reg.id::text, p_match_id,
     jsonb_build_object('player_id', p_player_id, 'status', v_status,
                        'queue_position', v_pos, 'roster_role', v_reg.roster_role));

  -- Keep the waiting list in sync after an admin-added player.
  perform public.promote_waitlist(p_match_id);

  return v_reg;
end;
$$;

-- ============================================================================
-- 8. FUNCTIONS — ADMIN ACCOUNT MANAGEMENT
-- ============================================================================

create or replace function public.approve_player(p_player_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
begin
  perform public.assert_admin();

  if p_player_id = (select auth.uid()) then
    raise exception 'CANNOT_MODIFY_SELF';
  end if;

  select * into v_target from public.profiles where id = p_player_id for update;
  if not found then
    raise exception 'PLAYER_NOT_FOUND';
  end if;
  if v_target.role = 'admin' then
    raise exception 'CANNOT_MODIFY_ADMIN';
  end if;
  if v_target.status = 'approved' then
    raise exception 'ALREADY_APPROVED';
  end if;

  -- A pending player may have claimed a shirt number that is now taken.
  if v_target.jersey_number is not null and exists (
    select 1
    from public.profiles p
    where p.id <> p_player_id
      and p.status = 'approved'
      and p.jersey_number = v_target.jersey_number
  ) then
    raise exception 'JERSEY_TAKEN' using hint = 'Clear the pending player''s shirt number first.';
  end if;

  update public.profiles
  set status = 'approved',
      approved_at = now(),
      approved_by = (select auth.uid()),
      rejection_reason = null
  where id = p_player_id
  returning * into v_target;

  insert into public.notifications (player_id, type, title_ar, body_ar)
  values (p_player_id, 'account_approved',
          'تمت الموافقة على حسابك',
          'يمكنك الآن التسجيل في المباريات واختيار مراكزك المفضلة.');

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values ((select auth.uid()), 'admin', 'account_approved', 'profile', p_player_id::text,
          jsonb_build_object('player_id', p_player_id));

  return v_target;
end;
$$;

create or replace function public.reject_player(p_player_id uuid, p_reason text default null)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
begin
  perform public.assert_admin();

  if p_player_id = (select auth.uid()) then
    raise exception 'CANNOT_MODIFY_SELF';
  end if;

  select * into v_target from public.profiles where id = p_player_id for update;
  if not found then
    raise exception 'PLAYER_NOT_FOUND';
  end if;
  if v_target.role = 'admin' then
    raise exception 'CANNOT_MODIFY_ADMIN';
  end if;
  if v_target.status = 'approved' then
    raise exception 'USE_SUSPEND_FOR_APPROVED_PLAYERS';
  end if;

  update public.profiles
  set status = 'rejected',
      rejection_reason = nullif(btrim(p_reason), '')
  where id = p_player_id
  returning * into v_target;

  insert into public.notifications (player_id, type, title_ar, body_ar)
  values (p_player_id, 'account_rejected',
          'لم تتم الموافقة على الحساب',
          coalesce(nullif(btrim(p_reason), ''), 'يرجى التواصل مع إدارة المجموعة.'));

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values ((select auth.uid()), 'admin', 'account_rejected', 'profile', p_player_id::text,
          jsonb_build_object('reason', p_reason));

  return v_target;
end;
$$;

create or replace function public.suspend_player(p_player_id uuid, p_reason text default null)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
  v_reg    record;
begin
  perform public.assert_admin();

  if p_player_id = (select auth.uid()) then
    raise exception 'CANNOT_MODIFY_SELF';
  end if;

  select * into v_target from public.profiles where id = p_player_id for update;
  if not found then
    raise exception 'PLAYER_NOT_FOUND';
  end if;
  if v_target.role = 'admin' then
    raise exception 'CANNOT_MODIFY_ADMIN';
  end if;

  update public.profiles
  set status = 'suspended',
      rejection_reason = nullif(btrim(p_reason), '')
  where id = p_player_id
  returning * into v_target;

  -- Release any active registrations and promote the waiting list.
  for v_reg in
    select r.id
    from public.registrations r
    join public.matches m on m.id = r.match_id
    where r.player_id = p_player_id
      and r.status <> 'cancelled'
      and m.status not in ('completed', 'cancelled')
  loop
    perform public.cancel_registration(v_reg.id);
  end loop;

  insert into public.notifications (player_id, type, title_ar, body_ar)
  values (p_player_id, 'account_suspended',
          'تم تعليق حسابك',
          coalesce(nullif(btrim(p_reason), ''), 'يرجى التواصل مع إدارة المجموعة.'));

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values ((select auth.uid()), 'admin', 'account_suspended', 'profile', p_player_id::text,
          jsonb_build_object('reason', p_reason));

  return v_target;
end;
$$;

-- ============================================================================
-- 9. FUNCTIONS — MATCH MANAGEMENT (admin only)
-- ============================================================================

create or replace function public.create_match(
  p_kickoff_at timestamptz,
  p_venue      text,
  p_address    text default null,
  p_notes      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.assert_admin();

  insert into public.matches
    (kickoff_at, registration_open_at, registration_close_at, local_date,
     venue, address, notes, created_by)
  values
    (p_kickoff_at, p_kickoff_at, p_kickoff_at,
     (p_kickoff_at at time zone 'Asia/Jerusalem')::date,
     btrim(p_venue), nullif(btrim(p_address), ''), nullif(btrim(p_notes), ''),
     (select auth.uid()))
  returning id into v_id;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'match_created', 'match', v_id::text, v_id,
          jsonb_build_object('kickoff_at', p_kickoff_at, 'venue', p_venue));

  return v_id;
end;
$$;

create or replace function public.update_match(
  p_match_id   uuid,
  p_kickoff_at timestamptz default null,
  p_venue      text default null,
  p_address    text default null,
  p_notes      text default null
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
begin
  perform public.assert_admin();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status in ('completed', 'cancelled') then
    raise exception 'MATCH_CLOSED';
  end if;

  update public.matches
  set kickoff_at = coalesce(p_kickoff_at, kickoff_at),
      venue      = coalesce(nullif(btrim(p_venue), ''), venue),
      address    = coalesce(p_address, address),
      notes      = coalesce(p_notes, notes)
  where id = p_match_id
  returning * into v_match;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'match_updated', 'match', p_match_id::text, p_match_id,
          jsonb_build_object('kickoff_at', p_kickoff_at, 'venue', p_venue));

  return v_match;
end;
$$;

create or replace function public.cancel_match(p_match_id uuid, p_reason text default null)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
begin
  perform public.assert_admin();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status = 'completed' then
    raise exception 'MATCH_ALREADY_COMPLETED';
  end if;
  if v_match.status = 'cancelled' then
    raise exception 'MATCH_ALREADY_CANCELLED';
  end if;

  update public.matches
  set status = 'cancelled',
      teams_stale = true
  where id = p_match_id
  returning * into v_match;

  insert into public.notifications (player_id, match_id, type, title_ar, body_ar)
  select r.player_id, p_match_id, 'match_cancelled',
         'تم إلغاء المباراة',
         coalesce(nullif(btrim(p_reason), ''), 'تم إلغاء مباراة هذا الأسبوع.')
  from public.registrations r
  where r.match_id = p_match_id and r.status <> 'cancelled';

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'match_cancelled', 'match', p_match_id::text, p_match_id,
          jsonb_build_object('reason', p_reason));

  return v_match;
end;
$$;

create or replace function public.complete_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
begin
  perform public.assert_admin();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status = 'cancelled' then
    raise exception 'MATCH_ALREADY_CANCELLED';
  end if;

  update public.matches set status = 'completed' where id = p_match_id
  returning * into v_match;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'match_completed', 'match', p_match_id::text, p_match_id, '{}'::jsonb);

  return v_match;
end;
$$;

create or replace function public.set_registration_lock(p_match_id uuid, p_locked boolean)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
begin
  perform public.assert_admin();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  update public.matches set registration_locked = p_locked
  where id = p_match_id
  returning * into v_match;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'registration_lock_changed', 'match',
          p_match_id::text, p_match_id, jsonb_build_object('locked', p_locked));

  return v_match;
end;
$$;

-- ============================================================================
-- 10. FUNCTIONS — TEAM DRAW
-- ============================================================================
-- Formation 1-3-3-2 (9 per team, 18 total).
-- Greedy position-aware bucketing + deterministic random split (seed).
-- Positions are taken from ranked player_positions; players without a natural
-- slot in their bucket are flagged is_out_of_position.
-- ============================================================================

create or replace function public.generate_teams(p_match_id uuid, p_seed text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match      public.matches%rowtype;
  v_seed       text;
  v_confirmed  integer;
  v_gk_count   integer;
  v_outfield_count integer;
  v_gk_index   integer := 0;
  v_team_a     uuid;
  v_team_b     uuid;
  v_name_a     text;
  v_name_b     text;
  v_color_a    text;
  v_color_b    text;
  v_remaining  jsonb;
  v_buckets    jsonb;
  v_cat        text;
  v_pri        smallint;
  v_score      integer;
  v_best_cat   text;
  v_best_score integer;
  v_pid        uuid;
  v_team       uuid;
  v_code       text;
  v_oop        boolean;
  v_total      integer;
  v_half       integer;
  v_i          integer;
  v_slot_a     integer := 0;
  v_slot_b     integer := 0;
  v_oop_count  integer;
  v_skill_gap  numeric;
  v_cost       numeric(10, 3);
  v_rec        record;
begin
  perform public.assert_admin();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status in ('cancelled', 'completed') then
    raise exception 'MATCH_CLOSED';
  end if;
  if v_match.team_size <> 9 then
    raise exception 'UNSUPPORTED_FORMATION' using hint = 'Only 9-a-side (1-3-3-2) is supported.';
  end if;

  select count(*) into v_confirmed
  from public.registrations r
  where r.match_id = p_match_id and r.status = 'confirmed';

  select rc.gk, rc.outfield into v_gk_count, v_outfield_count
  from public.roster_counts(p_match_id) rc;

  if v_confirmed <> 18 then
    raise exception 'INVALID_CONFIRMED_COUNT' using hint = 'Exactly 18 confirmed players are required.';
  end if;

  if v_gk_count <> 2 or v_outfield_count <> 16 then
    raise exception 'INVALID_ROSTER_COMPOSITION'
      using hint = 'Exactly 2 goalkeeper roles and 16 outfield roles are required.';
  end if;

  v_seed := coalesce(nullif(btrim(p_seed), ''), replace(gen_random_uuid()::text, '-', ''));

  select team_a_name, team_b_name, team_a_color, team_b_color
  into v_name_a, v_name_b, v_color_a, v_color_b
  from public.group_settings where id;
  if not found then
    v_name_a := 'الفريق الأخضر';
    v_name_b := 'الفريق الأبيض';
    v_color_a := '#d2ff4d';
    v_color_b := '#f5f3ea';
  end if;

  -- Re-generation replaces the previous snapshot.
  delete from public.match_teams where match_id = p_match_id;

  insert into public.match_teams (match_id, side, name_ar, color)
  values (p_match_id, 'A', v_name_a, v_color_a)
  returning id into v_team_a;

  insert into public.match_teams (match_id, side, name_ar, color)
  values (p_match_id, 'B', v_name_b, v_color_b)
  returning id into v_team_b;

  -- Role-GKs are placed first, one per team. The draw never infers a
  -- goalkeeper from position preferences; it uses the stored roster_role.
  for v_rec in
    select r.player_id
    from public.registrations r
    where r.match_id = p_match_id
      and r.status = 'confirmed'
      and r.roster_role = 'gk'
    order by r.queue_position
  loop
    v_gk_index := v_gk_index + 1;

    if v_gk_index = 1 then
      v_team := v_team_a;
    else
      v_team := v_team_b;
    end if;

    v_oop := not exists (
      select 1
      from public.player_positions pp
      join public.positions pos on pos.code = pp.position_code
      where pp.player_id = v_rec.player_id and pos.category = 'gk'
    );

    insert into public.team_assignments
      (match_id, team_id, player_id, assigned_position_code, slot_index, is_out_of_position)
    values
      (p_match_id, v_team, v_rec.player_id, 'GK',
       case when v_team = v_team_a then v_slot_a else v_slot_b end,
       v_oop);

    if v_team = v_team_a then
      v_slot_a := v_slot_a + 1;
    else
      v_slot_b := v_slot_b + 1;
    end if;
  end loop;

  -- Outfield slot budget across both teams: 6 DEF, 6 MID, 4 ATT.
  v_remaining := '{"defense": 6, "midfield": 6, "attack": 4}'::jsonb;
  v_buckets   := '{"defense": [], "midfield": [], "attack": []}'::jsonb;

  -- Pass 1: best-fit bucket assignment in seed-random order (outfield roles).
  for v_rec in
    select r.player_id
    from public.registrations r
    where r.match_id = p_match_id
      and r.status = 'confirmed'
      and r.roster_role = 'outfield'
    order by md5(v_seed || r.player_id::text)
  loop
    v_best_cat := null;
    v_best_score := -1;

    foreach v_cat in array array['defense', 'midfield', 'attack'] loop
      if (v_remaining ->> v_cat)::int > 0 then
        select min(pp.priority) into v_pri
        from public.player_positions pp
        join public.positions pos on pos.code = pp.position_code
        where pp.player_id = v_rec.player_id
          and pos.category = v_cat;

        v_score := case when v_pri is null then 0 else 6 - v_pri end;

        if v_best_cat is null
           or v_score > v_best_score
           or (v_score = v_best_score
               and (v_remaining ->> v_cat)::int > (v_remaining ->> v_best_cat)::int) then
          v_best_cat := v_cat;
          v_best_score := v_score;
        end if;
      end if;
    end loop;

    v_buckets := jsonb_set(
      v_buckets,
      array[v_best_cat],
      coalesce(v_buckets -> v_best_cat, '[]'::jsonb) || to_jsonb(v_rec.player_id)
    );
    v_remaining := jsonb_set(
      v_remaining,
      array[v_best_cat],
      to_jsonb(((v_remaining ->> v_best_cat)::int - 1))
    );
  end loop;

  if v_best_cat is null then
    raise exception 'DRAW_ASSIGNMENT_FAILED';
  end if;

  -- Pass 2: split every bucket evenly, A then B.
  foreach v_cat in array array['defense', 'midfield', 'attack'] loop
    v_total := jsonb_array_length(v_buckets -> v_cat);
    v_half  := v_total / 2;

    for v_i in 0 .. (v_total - 1) loop
      v_pid := (v_buckets -> v_cat ->> v_i)::uuid;

      if v_i < v_half then
        v_team := v_team_a;
      else
        v_team := v_team_b;
      end if;

      select pp.position_code into v_code
      from public.player_positions pp
      join public.positions pos on pos.code = pp.position_code
      where pp.player_id = v_pid and pos.category = v_cat
      order by pp.priority
      limit 1;

      if v_code is null then
        v_code := case v_cat
                    when 'defense' then 'CB'
                    when 'midfield' then 'CM'
                    else 'ST'
                  end;
      end if;

      v_oop := not exists (
        select 1
        from public.player_positions pp
        join public.positions pos on pos.code = pp.position_code
        where pp.player_id = v_pid and pos.category = v_cat
      );

      if v_team = v_team_a then
        insert into public.team_assignments
          (match_id, team_id, player_id, assigned_position_code, slot_index, is_out_of_position)
        values
          (p_match_id, v_team, v_pid, v_code, v_slot_a, v_oop);
        v_slot_a := v_slot_a + 1;
      else
        insert into public.team_assignments
          (match_id, team_id, player_id, assigned_position_code, slot_index, is_out_of_position)
        values
          (p_match_id, v_team, v_pid, v_code, v_slot_b, v_oop);
        v_slot_b := v_slot_b + 1;
      end if;
    end loop;
  end loop;

  -- Balance score used for auditing / regeneration comparison.
  select count(*) into v_oop_count
  from public.team_assignments ta
  where ta.match_id = p_match_id and ta.is_out_of_position;

  -- Hard invariants: 18 players, 9 per team.
  if (select count(*) from public.team_assignments ta where ta.match_id = p_match_id) <> 18 then
    raise exception 'DRAW_INCOMPLETE';
  end if;
  if (select count(*) from public.team_assignments ta where ta.match_id = p_match_id and ta.team_id = v_team_a) <> 9
     or (select count(*) from public.team_assignments ta where ta.match_id = p_match_id and ta.team_id = v_team_b) <> 9 then
    raise exception 'DRAW_UNBALANCED';
  end if;

  -- Each team must have exactly one goalkeeper role player.
  if (select count(*) from public.team_assignments ta
      where ta.match_id = p_match_id
        and ta.team_id = v_team_a
        and ta.assigned_position_code = 'GK') <> 1
     or (select count(*) from public.team_assignments ta
         where ta.match_id = p_match_id
           and ta.team_id = v_team_b
           and ta.assigned_position_code = 'GK') <> 1 then
    raise exception 'DRAW_GOALKEEPER_DISTRIBUTION'
      using hint = 'Each team must receive exactly one goalkeeper.';
  end if;

  select abs(
           coalesce(avg(case when ta.team_id = v_team_a then p.skill_level end), 0)
           - coalesce(avg(case when ta.team_id = v_team_b then p.skill_level end), 0)
         )
  into v_skill_gap
  from public.team_assignments ta
  join public.profiles p on p.id = ta.player_id
  where ta.match_id = p_match_id;

  v_cost := (v_oop_count * 2) + coalesce(v_skill_gap, 0);

  update public.matches
  set status = 'teams_published',
      teams_generated_at = now(),
      teams_generated_by = (select auth.uid()),
      teams_seed = v_seed,
      teams_cost = v_cost,
      teams_stale = false
  where id = p_match_id;

  insert into public.notifications (player_id, match_id, type, title_ar, body_ar)
  select ta.player_id, p_match_id, 'teams_published',
         'تم نشر الفرق',
         'تم توزيع اللاعبين على فريقين. تفقّد فريقك ومركزك في صفحة المباراة.'
  from public.team_assignments ta
  where ta.match_id = p_match_id;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'teams_generated', 'match', p_match_id::text, p_match_id,
          jsonb_build_object('seed', v_seed, 'cost', v_cost,
                             'out_of_position', v_oop_count,
                             'goalkeepers', v_gk_count,
                             'outfield', v_outfield_count));

  return;
end;
$$;

-- Manual swap: exchanges team + assigned slot between two players.
-- player_id stays put, so unique constraints are never violated mid-swap.
create or replace function public.swap_team_players(
  p_match_id uuid,
  p_player_a uuid,
  p_player_b uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a       public.team_assignments%rowtype;
  v_b       public.team_assignments%rowtype;
  v_a_is_gk boolean;
  v_b_is_gk boolean;
begin
  perform public.assert_admin();

  if p_player_a = p_player_b then
    raise exception 'SAME_PLAYER';
  end if;

  perform 1 from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  select * into v_a from public.team_assignments
  where match_id = p_match_id and player_id = p_player_a for update;
  if not found then
    raise exception 'ASSIGNMENT_NOT_FOUND';
  end if;

  select * into v_b from public.team_assignments
  where match_id = p_match_id and player_id = p_player_b for update;
  if not found then
    raise exception 'ASSIGNMENT_NOT_FOUND';
  end if;

  if v_a.team_id = v_b.team_id then
    raise exception 'SAME_TEAM';
  end if;

  select exists (
    select 1
    from public.registrations r
    where r.match_id = p_match_id
      and r.player_id = p_player_a
      and r.status = 'confirmed'
      and r.roster_role = 'gk'
  ) into v_a_is_gk;

  select exists (
    select 1
    from public.registrations r
    where r.match_id = p_match_id
      and r.player_id = p_player_b
      and r.status = 'confirmed'
      and r.roster_role = 'gk'
  ) into v_b_is_gk;

  -- Keep exactly one goalkeeper per team: a GK role may only be swapped with
  -- another GK role, never with an outfield role.
  if v_a_is_gk <> v_b_is_gk
     or (v_a.assigned_position_code = 'GK') <> (v_b.assigned_position_code = 'GK') then
    raise exception 'GK_SWAP_NOT_ALLOWED'
      using hint = 'A goalkeeper cannot be swapped with an outfield player.';
  end if;

  update public.team_assignments
  set team_id = case when id = v_a.id then v_b.team_id else v_a.team_id end,
      assigned_position_code = case when id = v_a.id then v_b.assigned_position_code
                                   else v_a.assigned_position_code end,
      slot_index = case when id = v_a.id then v_b.slot_index else v_a.slot_index end
  where id in (v_a.id, v_b.id);

  update public.team_assignments ta
  set is_out_of_position = not exists (
    select 1
    from public.player_positions pp
    join public.positions pos on pos.code = pp.position_code
    where pp.player_id = ta.player_id
      and pos.category = (
        select pos2.category from public.positions pos2
        where pos2.code = ta.assigned_position_code
      )
  )
  where ta.match_id = p_match_id;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'teams_swapped', 'match', p_match_id::text, p_match_id,
          jsonb_build_object('player_a', p_player_a, 'player_b', p_player_b));

  return;
end;
$$;

-- ============================================================================
-- 11. FUNCTIONS — TEAM STALENESS TRIGGERS
-- ============================================================================

create or replace function public.mark_teams_stale_for_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  if tg_table_name = 'player_positions' then
    if tg_op = 'DELETE' then
      v_player := old.player_id;
    else
      v_player := new.player_id;
    end if;
  else
    v_player := new.id;
  end if;

  update public.matches m
  set teams_stale = true
  where m.status in ('teams_published', 'registration_closed')
    and exists (select 1 from public.match_teams t where t.match_id = m.id)
    and exists (
      select 1 from public.registrations r
      where r.match_id = m.id and r.player_id = v_player and r.status = 'confirmed'
    );

  return null;
end;
$$;

drop trigger if exists player_positions_mark_stale on public.player_positions;
create trigger player_positions_mark_stale
  after insert or update or delete on public.player_positions
  for each row execute function public.mark_teams_stale_for_player();

drop trigger if exists profiles_skill_mark_stale on public.profiles;
create trigger profiles_skill_mark_stale
  after update of skill_level on public.profiles
  for each row execute function public.mark_teams_stale_for_player();

create or replace function public.mark_teams_stale_for_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.status = 'confirmed') <> (new.status = 'confirmed') then
    update public.matches m
    set teams_stale = true
    where m.id = new.match_id
      and m.status in ('teams_published', 'registration_closed')
      and exists (select 1 from public.match_teams t where t.match_id = m.id);
  end if;
  return null;
end;
$$;

drop trigger if exists registrations_mark_stale on public.registrations;
create trigger registrations_mark_stale
  after update of status on public.registrations
  for each row execute function public.mark_teams_stale_for_registration();

-- ============================================================================
-- 12. SECURE FIRST-ADMIN BOOTSTRAP
-- ============================================================================
-- Callable only by the service role / SQL editor (never by anon/authenticated).
-- It refuses to run once any admin exists, and refuses when a user JWT is
-- present, so it cannot be triggered from the frontend.
-- ============================================================================

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

  select count(*)
  into v_count
  from auth.users u
  where regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = v_digits;

  if v_count = 0 then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_count > 1 then
    raise exception 'PHONE_AMBIGUOUS';
  end if;

  select u.id into v_id
  from auth.users u
  where regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = v_digits
  limit 1;

  select * into v_profile
  from public.profiles
  where id = v_id
  for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if v_profile.role <> 'player'
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

-- ============================================================================
-- 13. FUNCTION PRIVILEGES
-- ============================================================================

-- Helpers used by RLS policies.
revoke all on function public.is_admin() from public;
revoke all on function public.is_approved() from public;
revoke all on function public.can_manage_own_profile() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.can_manage_own_profile() to authenticated;

-- Player RPCs.
revoke all on function public.update_my_profile(text, text, text, smallint) from public;
revoke all on function public.set_my_positions(text[]) from public;
revoke all on function public.register_for_match(uuid) from public;
revoke all on function public.cancel_registration(uuid) from public;
grant execute on function public.update_my_profile(text, text, text, smallint) to authenticated;
grant execute on function public.set_my_positions(text[]) to authenticated;
grant execute on function public.register_for_match(uuid) to authenticated;
grant execute on function public.cancel_registration(uuid) to authenticated;

-- Admin RPCs (authorization is re-checked inside each function).
revoke all on function public.approve_player(uuid) from public;
revoke all on function public.reject_player(uuid, text) from public;
revoke all on function public.suspend_player(uuid, text) from public;
revoke all on function public.admin_add_registration(uuid, uuid) from public;
revoke all on function public.create_match(timestamptz, text, text, text) from public;
revoke all on function public.update_match(uuid, timestamptz, text, text, text) from public;
revoke all on function public.cancel_match(uuid, text) from public;
revoke all on function public.complete_match(uuid) from public;
revoke all on function public.set_registration_lock(uuid, boolean) from public;
revoke all on function public.generate_teams(uuid, text) from public;
revoke all on function public.swap_team_players(uuid, uuid, uuid) from public;

grant execute on function public.approve_player(uuid) to authenticated;
grant execute on function public.reject_player(uuid, text) to authenticated;
grant execute on function public.suspend_player(uuid, text) to authenticated;
grant execute on function public.admin_add_registration(uuid, uuid) to authenticated;
grant execute on function public.create_match(timestamptz, text, text, text) to authenticated;
grant execute on function public.update_match(uuid, timestamptz, text, text, text) to authenticated;
grant execute on function public.cancel_match(uuid, text) to authenticated;
grant execute on function public.complete_match(uuid) to authenticated;
grant execute on function public.set_registration_lock(uuid, boolean) to authenticated;
grant execute on function public.generate_teams(uuid, text) to authenticated;
grant execute on function public.swap_team_players(uuid, uuid, uuid) to authenticated;

-- Internal helpers: no client access at all.
revoke all on function public.assert_admin() from public;
revoke all on function public.notify_admins(uuid, text, text, text) from public;
revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_user_phone_change() from public;
revoke all on function public.set_match_schedule() from public;
revoke all on function public.mark_teams_stale_for_player() from public;
revoke all on function public.mark_teams_stale_for_registration() from public;

-- Roster composition helpers: internal only, never callable by clients.
revoke all on function public.player_roster_class(uuid) from public;
revoke all on function public.roster_counts(uuid) from public;
revoke all on function public.roster_eligibility(uuid, uuid) from public;
revoke all on function public.promote_waitlist(uuid) from public;
revoke all on function public.player_roster_class(uuid) from anon, authenticated;
revoke all on function public.roster_counts(uuid) from anon, authenticated;
revoke all on function public.roster_eligibility(uuid, uuid) from anon, authenticated;
revoke all on function public.promote_waitlist(uuid) from anon, authenticated;

-- Bootstrap: service role only.
revoke all on function public.bootstrap_first_admin(text) from public;
revoke all on function public.bootstrap_first_admin(text) from anon;
revoke all on function public.bootstrap_first_admin(text) from authenticated;
grant execute on function public.bootstrap_first_admin(text) to service_role;

-- ============================================================================
-- 14. SEED DATA
-- ============================================================================

insert into public.group_settings
  (id, group_name, timezone, capacity, team_size, formation,
   team_a_name, team_b_name, team_a_color, team_b_color)
values
  (true, 'Friday Elite', 'Asia/Jerusalem', 18, 9, '1-3-3-2',
   'الفريق الأخضر', 'الفريق الأبيض', '#d2ff4d', '#f5f3ea')
on conflict (id) do nothing;

insert into public.positions (code, name_ar, name_en, category, sort_order) values
  ('GK', 'حارس مرمى',      'Goalkeeper',          'gk',       1),
  ('CB', 'قلب دفاع',       'Centre Back',         'defense',  2),
  ('LB', 'ظهير أيسر',      'Left Back',           'defense',  3),
  ('RB', 'ظهير أيمن',      'Right Back',          'defense',  4),
  ('DM', 'وسط مدافع',      'Defensive Midfielder','midfield', 5),
  ('CM', 'وسط ملعب',       'Central Midfielder',  'midfield', 6),
  ('AM', 'صانع ألعاب',     'Attacking Midfielder','midfield', 7),
  ('LW', 'جناح أيسر',      'Left Winger',         'attack',   8),
  ('RW', 'جناح أيمن',      'Right Winger',        'attack',   9),
  ('ST', 'مهاجم صريح',     'Striker',             'attack',  10)
on conflict (code) do nothing;

-- ============================================================================
-- END OF MIGRATION 0001
-- ============================================================================
