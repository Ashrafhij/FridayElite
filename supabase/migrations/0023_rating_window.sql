-- ============================================================================
-- Friday Elite — Migration 0023
-- Rating window: players can only rate within 48 hours after kickoff.
--
-- Updates public.rate_player so ratings (new or changed) are rejected once
-- the match's kickoff is more than 2 days in the past. This prevents players
-- from going back to old matches and changing ratings long after the fact.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0022.
-- ============================================================================

begin;

create or replace function public.rate_player(
  p_match_id         uuid,
  p_rated_player_id  uuid,
  p_rating           integer
)
returns public.player_ratings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_match public.matches%rowtype;
  v_row   public.player_ratings%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if p_rated_player_id = v_uid then
    raise exception 'CANNOT_RATE_SELF';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 10 then
    raise exception 'INVALID_RATING';
  end if;
  if not public.is_approved() then
    raise exception 'ACCOUNT_NOT_APPROVED';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status <> 'completed' then
    raise exception 'MATCH_NOT_COMPLETED';
  end if;

  -- Ratings are locked 48 hours after kickoff: no late edits to old matches.
  if now() > v_match.kickoff_at + interval '2 days' then
    raise exception 'RATING_WINDOW_CLOSED';
  end if;

  if not exists (
    select 1 from public.registrations r
     where r.match_id = p_match_id
       and r.player_id = v_uid
       and r.status = 'confirmed'
  ) then
    raise exception 'NOT_MATCH_PARTICIPANT';
  end if;

  if not exists (
    select 1 from public.registrations r
     where r.match_id = p_match_id
       and r.player_id = p_rated_player_id
       and r.status = 'confirmed'
  ) then
    raise exception 'NOT_MATCH_PARTICIPANT';
  end if;

  insert into public.player_ratings (match_id, rater_id, rated_player_id, rating)
  values (p_match_id, v_uid, p_rated_player_id, p_rating)
  on conflict (match_id, rater_id, rated_player_id) do update
    set rating = excluded.rating,
        updated_at = now()
  returning * into v_row;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values (v_uid, 'player', 'player_rated', 'player_rating', v_row.id::text, p_match_id,
          jsonb_build_object('rated_player_id', p_rated_player_id, 'rating', p_rating));

  return v_row;
end;
$$;

revoke all on function public.rate_player(uuid, uuid, integer) from public;
grant execute on function public.rate_player(uuid, uuid, integer) to authenticated;

commit;
