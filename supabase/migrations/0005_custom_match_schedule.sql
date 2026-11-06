-- ============================================================================
-- Friday Elite — Migration 0005
-- Custom admin matches on any day/time.
--
-- The weekly Friday 20:00 match remains automatic. Admins can now also create
-- one-off matches on any day and time. The creation form sends explicit
-- registration_open_at / registration_close_at values; when omitted, the
-- defaults are:
--   * registration opens the previous local day at 10:00
--   * registration closes at kickoff
--
-- Run this ONCE in the Supabase SQL editor after 0001-0004.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Flexible schedule validation (no forced Friday/time)
-- ----------------------------------------------------------------------------
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

  if new.registration_open_at is null
     or new.registration_close_at is null then
    raise exception 'INVALID_REGISTRATION_WINDOW'
      using hint = 'Registration open and close times are required.';
  end if;

  if new.registration_open_at >= new.registration_close_at
     or new.registration_close_at > new.kickoff_at then
    raise exception 'INVALID_REGISTRATION_WINDOW'
      using hint = 'Registration must open before it closes, and close no later than kickoff.';
  end if;

  new.local_date := v_local::date;

  return new;
end;
$$;

drop trigger if exists matches_set_schedule on public.matches;
drop trigger if exists matches_set_schedule_update on public.matches;

create trigger matches_set_schedule
  before insert on public.matches
  for each row execute function public.set_match_schedule();

create trigger matches_set_schedule_update
  before update of kickoff_at, registration_open_at, registration_close_at on public.matches
  for each row
  when (
    old.kickoff_at is distinct from new.kickoff_at
    or old.registration_open_at is distinct from new.registration_open_at
    or old.registration_close_at is distinct from new.registration_close_at
  )
  execute function public.set_match_schedule();

-- ----------------------------------------------------------------------------
-- 2. Admin create/update RPCs with explicit registration window
-- ----------------------------------------------------------------------------
drop function if exists public.create_match(timestamptz, text, text, text);

create or replace function public.create_match(
  p_kickoff_at               timestamptz,
  p_venue                    text,
  p_address                  text default null,
  p_notes                    text default null,
  p_registration_open_at     timestamptz default null,
  p_registration_close_at    timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_tz       text := 'Asia/Jerusalem';
  v_kickoff_local timestamp;
  v_open_at  timestamptz;
  v_close_at timestamptz;
begin
  perform public.assert_admin();

  select g.timezone into v_tz
    from public.group_settings g
   where g.id;
  v_tz := coalesce(v_tz, 'Asia/Jerusalem');
  v_kickoff_local := p_kickoff_at at time zone v_tz;

  v_close_at := coalesce(p_registration_close_at, p_kickoff_at);
  v_open_at := coalesce(
    p_registration_open_at,
    ((v_kickoff_local::date - 1) + time '10:00') at time zone v_tz
  );

  if v_open_at >= v_close_at or v_close_at > p_kickoff_at then
    raise exception 'INVALID_REGISTRATION_WINDOW';
  end if;

  insert into public.matches (
    kickoff_at,
    registration_open_at,
    registration_close_at,
    local_date,
    venue,
    address,
    notes,
    created_by
  )
  values (
    p_kickoff_at,
    v_open_at,
    v_close_at,
    v_kickoff_local::date,
    btrim(p_venue),
    nullif(btrim(p_address), ''),
    nullif(btrim(p_notes), ''),
    (select auth.uid())
  )
  returning id into v_id;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'match_created', 'match', v_id::text, v_id,
          jsonb_build_object(
            'kickoff_at', p_kickoff_at,
            'registration_open_at', v_open_at,
            'registration_close_at', v_close_at,
            'venue', p_venue
          ));

  return v_id;
end;
$$;

revoke all on function public.create_match(timestamptz, text, text, text, timestamptz, timestamptz) from public;
grant execute on function public.create_match(timestamptz, text, text, text, timestamptz, timestamptz) to authenticated;

drop function if exists public.update_match(uuid, timestamptz, text, text, text);

create or replace function public.update_match(
  p_match_id                uuid,
  p_kickoff_at              timestamptz default null,
  p_venue                   text default null,
  p_address                 text default null,
  p_notes                   text default null,
  p_registration_open_at    timestamptz default null,
  p_registration_close_at   timestamptz default null
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
  v_kickoff timestamptz;
  v_open_at timestamptz;
  v_close_at timestamptz;
begin
  perform public.assert_admin();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status in ('completed', 'cancelled') then
    raise exception 'MATCH_CLOSED';
  end if;

  v_kickoff := coalesce(p_kickoff_at, v_match.kickoff_at);
  v_close_at := coalesce(p_registration_close_at, v_match.registration_close_at);
  v_open_at := coalesce(p_registration_open_at, v_match.registration_open_at);

  -- If kickoff moves, preserve the previous open time only when it still fits;
  -- otherwise fall back to the standard previous-day 10:00 default.
  if p_kickoff_at is not null
     and p_registration_open_at is null
     and v_open_at >= v_close_at then
    v_open_at := ((v_kickoff at time zone 'Asia/Jerusalem')::date - 1 + time '10:00')
                 at time zone 'Asia/Jerusalem';
  end if;

  if v_open_at >= v_close_at or v_close_at > v_kickoff then
    raise exception 'INVALID_REGISTRATION_WINDOW';
  end if;

  update public.matches
     set kickoff_at = v_kickoff,
         registration_open_at = v_open_at,
         registration_close_at = v_close_at,
         venue = coalesce(nullif(btrim(p_venue), ''), venue),
         address = coalesce(p_address, address),
         notes = coalesce(p_notes, notes)
   where id = p_match_id
   returning * into v_match;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'match_updated', 'match', p_match_id::text, p_match_id,
          jsonb_build_object(
            'kickoff_at', v_kickoff,
            'registration_open_at', v_open_at,
            'registration_close_at', v_close_at,
            'venue', p_venue
          ));

  return v_match;
end;
$$;

revoke all on function public.update_match(uuid, timestamptz, text, text, text, timestamptz, timestamptz) from public;
grant execute on function public.update_match(uuid, timestamptz, text, text, text, timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Keep the automatic weekly Friday fixture on the Friday schedule
-- ----------------------------------------------------------------------------
create or replace function public.ensure_weekly_matches()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz         text := 'Asia/Jerusalem';
  v_capacity   smallint := 18;
  v_team_size  smallint := 9;
  v_formation  text := '1-3-3-2';
  v_venue      text := 'ملعب وحيد — العشب الصناعي';
  v_address    text;
  v_today      date;
  v_dow        integer;
  v_friday     date;
  v_kickoff    timestamptz;
  v_open_at    timestamptz;
  v_match_id   uuid;
  v_created    integer := 0;
  v_offset     integer;
begin
  select g.timezone, g.capacity, g.team_size, g.formation
    into v_tz, v_capacity, v_team_size, v_formation
    from public.group_settings g
   where g.id;

  if not found then
    v_tz := 'Asia/Jerusalem';
    v_capacity := 18;
    v_team_size := 9;
    v_formation := '1-3-3-2';
  end if;

  select m.venue, m.address
    into v_venue, v_address
    from public.matches m
   order by m.kickoff_at desc
   limit 1;

  v_venue := coalesce(nullif(btrim(v_venue), ''), 'ملعب وحيد — العشب الصناعي');

  v_today := (now() at time zone v_tz)::date;
  v_dow := extract(isodow from v_today)::integer;
  v_friday := v_today + ((5 - v_dow + 7) % 7);

  for v_offset in 0..7 loop
    v_kickoff := ((v_friday + v_offset * 7) + time '20:00') at time zone v_tz;
    v_open_at := (((v_friday + v_offset * 7) - 1) + time '10:00') at time zone v_tz;

    insert into public.matches (
      kickoff_at,
      registration_open_at,
      registration_close_at,
      local_date,
      venue,
      address,
      notes,
      capacity,
      team_size,
      formation,
      status,
      created_by
    )
    values (
      v_kickoff,
      v_open_at,
      v_kickoff,
      v_friday + v_offset * 7,
      v_venue,
      v_address,
      null,
      v_capacity,
      v_team_size,
      v_formation,
      'scheduled',
      null
    )
    on conflict (local_date) do nothing
    returning id into v_match_id;

    if found then
      v_created := v_created + 1;
      insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
      values (null, 'system', 'match_auto_created', 'match', v_match_id::text, v_match_id,
              jsonb_build_object('source', 'weekly_schedule'));
    end if;
  end loop;

  update public.matches m
     set status = case
       when m.status in ('cancelled', 'completed') then m.status
       when now() >= m.kickoff_at + interval '3 hours' then 'completed'
       when now() >= m.registration_close_at
        and m.status in ('scheduled', 'registration_open') then 'registration_closed'
       when now() >= m.registration_open_at
        and m.status = 'scheduled' then 'registration_open'
       when now() < m.registration_open_at
        and m.status = 'registration_open' then 'scheduled'
       else m.status
     end
   where m.status not in ('cancelled', 'completed');

  return v_created;
end;
$$;

revoke all on function public.ensure_weekly_matches() from public;
grant execute on function public.ensure_weekly_matches() to authenticated, service_role;

commit;
