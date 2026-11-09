-- ============================================================================
-- Friday Elite — Migration 0031
-- Admin-only view of WHO rated WHOM (participation only, never the values).
--
-- The admin wants to see which players voted and for which players, WITHOUT
-- seeing the actual rating numbers. admin_match_rating_votes() returns only
-- (rater, rated) name pairs — the rating column is never read or returned,
-- and the function refuses non-admin callers.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0030.
-- ============================================================================

begin;

create or replace function public.admin_match_rating_votes(p_match_id uuid)
returns table (
  rater_id          uuid,
  rater_name        text,
  rated_player_id   uuid,
  rated_player_name text,
  created_at        timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  perform public.assert_admin();

  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and m.status <> 'draft'
  ) then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  return query
    select pr.rater_id, rp.full_name, pr.rated_player_id, np.full_name, pr.created_at
    from public.player_ratings pr
    join public.profiles rp on rp.id = pr.rater_id
    join public.profiles np on np.id = pr.rated_player_id
    where pr.match_id = p_match_id
    order by rp.full_name, np.full_name;
end;
$$;

revoke all on function public.admin_match_rating_votes(uuid) from public;
grant execute on function public.admin_match_rating_votes(uuid) to authenticated;

commit;
