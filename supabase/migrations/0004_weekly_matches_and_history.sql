-- ============================================================================
-- Friday Elite — Migration 0004
-- Weekly matches and match history statistics.
--
-- The existing match trigger already forces Friday 20:00 local kickoff and
-- derives the registration window (Thursday 10:00 -> Friday 20:00). This
-- migration adds:
--   * ensure_weekly_matches(): idempotently creates upcoming Friday matches
--     and advances their status at the open/close boundaries.
--   * pg_cron schedule every 5 minutes (best-effort if pg_cron is available).
--   * match_history_stats: durable per-match registration/team statistics for
--     current and previous weeks.
--
-- Run this ONCE in the Supabase SQL editor after 0001/0002/0003.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Weekly match creator + status advancement
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
  v_venue      text := 'ملعب الحي — العشب الصناعي';
  v_address    text;
  v_today      date;
  v_dow        integer;
  v_friday     date;
  v_kickoff    timestamptz;
  v_match_id   uuid;
  v_created    integer := 0;
  v_offset     integer;
begin
  -- Use the group's configured capacity/formation/timezone when available.
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

  -- Carry forward the most recently used venue/address. Notes are intentionally
  -- not copied because they are usually week-specific.
  select m.venue, m.address
    into v_venue, v_address
    from public.matches m
   order by m.kickoff_at desc
   limit 1;

  v_venue := coalesce(nullif(btrim(v_venue), ''), 'ملعب الحي — العشب الصناعي');

  -- Friday of the current week (or the next Friday if today is Sat-Thu).
  v_today := (now() at time zone v_tz)::date;
  v_dow := extract(isodow from v_today)::integer;
  v_friday := v_today + ((5 - v_dow + 7) % 7);

  -- Create the current Friday and the next seven Fridays. The unique local_date
  -- constraint makes this idempotent; the schedule trigger derives the exact
  -- Thursday 10:00 open and Friday 20:00 close.
  for v_offset in 0..7 loop
    v_kickoff := ((v_friday + v_offset * 7) + time '20:00') at time zone v_tz;

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
      v_kickoff,
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

  -- Advance statuses at the registration boundaries. Counts/registrations for
  -- older matches are never deleted, so previous-week statistics remain stored.
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

-- Best-effort pg_cron automation. If pg_cron is unavailable, the Matches page
-- calls the same idempotent function when it loads.
do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;

    if exists (
      select 1 from cron.job
       where jobname = 'friday-elite-ensure-weekly-matches'
    ) then
      perform cron.unschedule('friday-elite-ensure-weekly-matches');
    end if;

    perform cron.schedule(
      'friday-elite-ensure-weekly-matches',
      '*/5 * * * *',
      $cmd$select public.ensure_weekly_matches();$cmd$
    );
  exception when others then
    raise notice 'Weekly match scheduler setup skipped: %', sqlerrm;
  end;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Durable per-match statistics (current and previous weeks)
-- ----------------------------------------------------------------------------
create or replace view public.match_history_stats
with (security_invoker = true) as
select
  m.id as match_id,
  m.kickoff_at,
  m.local_date,
  m.registration_open_at,
  m.registration_close_at,
  m.venue,
  m.address,
  m.status,
  m.capacity,
  m.team_size,
  m.formation,
  coalesce(reg.confirmed_count, 0)::integer as confirmed_count,
  coalesce(reg.waitlisted_count, 0)::integer as waitlisted_count,
  coalesce(reg.cancelled_count, 0)::integer as cancelled_count,
  coalesce(reg.total_count, 0)::integer as total_registration_count,
  coalesce(tm.team_a_count, 0)::integer as team_a_count,
  coalesce(tm.team_b_count, 0)::integer as team_b_count
from public.matches m
left join lateral (
  select
    count(*) filter (where r.status = 'confirmed')::integer as confirmed_count,
    count(*) filter (where r.status = 'waitlisted')::integer as waitlisted_count,
    count(*) filter (where r.status = 'cancelled')::integer as cancelled_count,
    count(*)::integer as total_count
  from public.registrations r
  where r.match_id = m.id
) reg on true
left join lateral (
  select
    count(ta.id) filter (where mt.side = 'A')::integer as team_a_count,
    count(ta.id) filter (where mt.side = 'B')::integer as team_b_count
  from public.match_teams mt
  left join public.team_assignments ta
    on ta.team_id = mt.id
   and ta.match_id = m.id
  where mt.match_id = m.id
) tm on true;

revoke all on public.match_history_stats from public;
grant select on public.match_history_stats to authenticated;

commit;
