-- ============================================================================
-- Friday Elite — Migration 0022
-- Make player rating averages robust against single lowball ("troll") ratings.
--
-- Previously match_player_rating_stats used a plain AVG, so one malicious
-- 1-star rating could drag a player's average far below their real ratings.
-- This switches the aggregate to a TRIMMED MEAN: when a player has 5 or more
-- ratings for a match, one lowest and one highest rating are excluded before
-- averaging; with fewer ratings the plain average is used (not enough data to
-- trim safely). The change applies to refresh_match_player_rating_stat() so
-- all future ratings use it, and existing averages are recomputed below.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0021.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Trimmed-mean aggregation in the stat refresher
-- ----------------------------------------------------------------------------
create or replace function public.refresh_match_player_rating_stat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_id uuid;
  v_player_id uuid;
begin
  if tg_op = 'DELETE' then
    v_match_id := old.match_id;
    v_player_id := old.rated_player_id;
  else
    v_match_id := new.match_id;
    v_player_id := new.rated_player_id;
  end if;

  if exists (
    select 1
      from public.player_ratings
     where match_id = v_match_id
       and rated_player_id = v_player_id
  ) then
    insert into public.match_player_rating_stats (match_id, player_id, average_rating, rating_count)
    select
      v_match_id,
      v_player_id,
      round((
        case
          when count(*) >= 5
            then (sum(rating) - min(rating) - max(rating))::numeric / (count(*) - 2)
          else avg(rating)::numeric
        end
      ), 2),
      count(*)::integer
      from public.player_ratings
     where match_id = v_match_id
       and rated_player_id = v_player_id
    on conflict (match_id, player_id) do update
      set average_rating = excluded.average_rating,
          rating_count = excluded.rating_count,
          updated_at = now();
  end if;

  delete from public.match_player_rating_stats
   where match_id = v_match_id
     and player_id = v_player_id
     and not exists (
       select 1 from public.player_ratings
        where match_id = v_match_id
          and rated_player_id = v_player_id
     );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Backfill: recompute every existing average with the trimmed formula
-- ----------------------------------------------------------------------------
insert into public.match_player_rating_stats (match_id, player_id, average_rating, rating_count)
select
  match_id,
  rated_player_id,
  round((
    case
      when count(*) >= 5
        then (sum(rating) - min(rating) - max(rating))::numeric / (count(*) - 2)
      else avg(rating)::numeric
    end
  ), 2),
  count(*)::integer
from public.player_ratings
group by match_id, rated_player_id
on conflict (match_id, player_id) do update
  set average_rating = excluded.average_rating,
      rating_count = excluded.rating_count,
      updated_at = now();

commit;
