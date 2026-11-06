-- ============================================================================
-- Friday Elite — Migration 0009
-- All-time player goals/assists statistics.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0008.
-- ============================================================================

begin;

create or replace view public.player_all_time_stats
with (security_invoker = true) as
select
  p.id as player_id,
  coalesce(sum(ms.goals), 0)::integer as total_goals,
  coalesce(sum(ms.assists), 0)::integer as total_assists,
  count(ms.id)::integer as matches_with_stats,
  coalesce(
    round(avg(ms.goals)::numeric, 2),
    0
  ) as average_goals,
  coalesce(
    round(avg(ms.assists)::numeric, 2),
    0
  ) as average_assists
from public.player_directory p
left join public.match_scorers ms
  on ms.player_id = p.id
left join public.matches m
  on m.id = ms.match_id
 and m.status = 'completed'
where ms.id is null or m.status = 'completed'
group by p.id;

revoke all on public.player_all_time_stats from public;
grant select on public.player_all_time_stats to authenticated;

commit;
