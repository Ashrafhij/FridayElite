-- ============================================================================
-- Friday Elite — Migration 0017
-- Admin can change an assigned player's position directly.
--
-- Adds public.set_player_match_position(p_match_id, p_player_id, p_position_code):
-- - Assigns any active position (including GK) to an already-assigned player,
--   regardless of the player's registered position preferences.
-- - Teams/slots are untouched; the player simply moves to the matching
--   formation row on the pitch. is_out_of_position is recomputed as an
--   informational flag.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0016.
-- ============================================================================

begin;

create or replace function public.set_player_match_position(
  p_match_id        uuid,
  p_player_id       uuid,
  p_position_code   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match   public.matches%rowtype;
  v_code    text := nullif(btrim(p_position_code), '');
begin
  perform public.assert_admin();

  if v_code is null
     or not exists (
       select 1 from public.positions
        where code = v_code and is_active
     ) then
    raise exception 'INVALID_POSITION';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status = 'cancelled' then
    raise exception 'MATCH_CLOSED';
  end if;

  if not exists (
    select 1 from public.team_assignments
     where match_id = p_match_id and player_id = p_player_id
  ) then
    raise exception 'ASSIGNMENT_NOT_FOUND';
  end if;

  -- Admin override: no position-preference check. Just place the player.
  update public.team_assignments
     set assigned_position_code = v_code
   where match_id = p_match_id and player_id = p_player_id;

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
   where ta.match_id = p_match_id and ta.player_id = p_player_id;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'player_match_position_set', 'match', p_match_id::text, p_match_id,
          jsonb_build_object('player_id', p_player_id, 'position_code', v_code));

  return;
end;
$$;

revoke all on function public.set_player_match_position(uuid, uuid, text) from public;
grant execute on function public.set_player_match_position(uuid, uuid, text) to authenticated;

commit;
