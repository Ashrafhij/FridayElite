-- ============================================================================
-- Friday Elite — Migration 0006
-- Real-time updates for match registrations and teams.
--
-- The frontend subscribes to Postgres changes on these tables so other players
-- see new registrations / cancellations / generated squads immediately.
-- If Realtime is unavailable, the application falls back to short polling.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0005.
-- ============================================================================

begin;

do $$
declare
  v_table text;
begin
  begin
    if not exists (
      select 1 from pg_publication where pubname = 'supabase_realtime'
    ) then
      execute 'create publication supabase_realtime';
    end if;

    foreach v_table in array array[
      'public.matches',
      'public.registrations',
      'public.match_teams',
      'public.team_assignments'
    ] loop
      if not exists (
        select 1
          from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = split_part(v_table, '.', 1)
           and tablename = split_part(v_table, '.', 2)
      ) then
        execute format('alter publication supabase_realtime add table %s', v_table);
      end if;
    end loop;
  exception when others then
    -- The app still works with polling if Realtime cannot be enabled.
    raise notice 'Realtime publication setup skipped: %', sqlerrm;
  end;
end $$;

commit;
