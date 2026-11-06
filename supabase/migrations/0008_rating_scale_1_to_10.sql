-- ============================================================================
-- Friday Elite — Migration 0008
-- Change post-match rating scale from 1-5 to 1-10.
--
-- If 0007 has not been applied yet, the updated 0007 already uses 1-10 and
-- this migration is harmless/idempotent when run after it.
-- ============================================================================

begin;

alter table public.player_ratings
  drop constraint if exists player_ratings_rating_check;

alter table public.player_ratings
  add constraint player_ratings_rating_check check (rating between 1 and 10);

alter table public.match_player_rating_stats
  drop constraint if exists match_player_rating_stats_average_rating_check;

alter table public.match_player_rating_stats
  alter column average_rating type numeric(4, 2);

alter table public.match_player_rating_stats
  add constraint match_player_rating_stats_average_rating_check
  check (average_rating between 1 and 10);

-- Replace the rating RPC validation with the 1-10 scale.
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
