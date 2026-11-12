-- ============================================================================
-- Friday Elite — Migration 0036
-- Player match record: wins, losses, ties and matches played.
--
-- Extends public.player_all_time_stats view with:
--   * matches_played — completed matches the player was assigned to a team in
--   * wins — matches where the player's team scored more than the opponent
--   * losses — matches where the player's team scored less than the opponent
--   * ties — matches where both teams scored the same
--
-- Run this ONCE in the Supabase SQL editor after 0001-0035.
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
  ) as average_assists,
  -- Matches played: completed matches with a result where the player
  -- was assigned to a team.
  coalesce((
    select count(distinct ta.match_id)::integer
    from public.team_assignments ta
    join public.match_results mr on mr.match_id = ta.match_id
    where ta.player_id = p.id
  ), 0) as matches_played,
  -- Wins: the player's team scored more than the opponent.
  coalesce((
    select count(distinct ta.match_id)::integer
    from public.team_assignments ta
    join public.match_teams mt on mt.id = ta.team_id and mt.match_id = ta.match_id
    join public.match_results mr on mr.match_id = ta.match_id
    where ta.player_id = p.id
      and (
        (mt.side = 'A' and mr.team_a_score > mr.team_b_score)
        or (mt.side = 'B' and mr.team_b_score > mr.team_a_score)
      )
  ), 0) as wins,
  -- Losses: the player's team scored less than the opponent.
  coalesce((
    select count(distinct ta.match_id)::integer
    from public.team_assignments ta
    join public.match_teams mt on mt.id = ta.team_id and mt.match_id = ta.match_id
    join public.match_results mr on mr.match_id = ta.match_id
    where ta.player_id = p.id
      and (
        (mt.side = 'A' and mr.team_a_score < mr.team_b_score)
        or (mt.side = 'B' and mr.team_b_score < mr.team_a_score)
      )
  ), 0) as losses,
  -- Ties: both teams scored the same.
  coalesce((
    select count(distinct ta.match_id)::integer
    from public.team_assignments ta
    join public.match_teams mt on mt.id = ta.team_id and mt.match_id = ta.match_id
    join public.match_results mr on mr.match_id = ta.match_id
    where ta.player_id = p.id
      and mr.team_a_score = mr.team_b_score
  ), 0) as ties
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
