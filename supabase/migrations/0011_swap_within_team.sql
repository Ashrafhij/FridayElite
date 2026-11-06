-- ============================================================================
-- Friday Elite — Migration 0011
-- Allow team swaps within the same team as well as across teams.
--
-- Existing profiles/registrations are unaffected. This change only modifies
-- public.swap_team_players so two assigned players on the same side can swap
-- their assigned position and pitch slot. Cross-team swaps remain subject to
-- the existing goalkeeper/outfield guard.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0010.
-- ============================================================================

begin;

create or replace function public.swap_team_players(
  p_match_id uuid,
  p_player_a uuid,
  p_player_b uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a       public.team_assignments%rowtype;
  v_b       public.team_assignments%rowtype;
  v_a_is_gk boolean;
  v_b_is_gk boolean;
begin
  perform public.assert_admin();

  if p_player_a = p_player_b then
    raise exception 'SAME_PLAYER';
  end if;

  perform 1 from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  select * into v_a from public.team_assignments
  where match_id = p_match_id and player_id = p_player_a for update;
  if not found then
    raise exception 'ASSIGNMENT_NOT_FOUND';
  end if;

  select * into v_b from public.team_assignments
  where match_id = p_match_id and player_id = p_player_b for update;
  if not found then
    raise exception 'ASSIGNMENT_NOT_FOUND';
  end if;

  select exists (
    select 1
    from public.registrations r
    where r.match_id = p_match_id
      and r.player_id = p_player_a
      and r.status = 'confirmed'
      and r.roster_role = 'gk'
  ) into v_a_is_gk;

  select exists (
    select 1
    from public.registrations r
    where r.match_id = p_match_id
      and r.player_id = p_player_b
      and r.status = 'confirmed'
      and r.roster_role = 'gk'
  ) into v_b_is_gk;

  -- Keep exactly one goalkeeper per team: a GK role may only be swapped with
  -- another GK role, never with an outfield role. This rule applies within the
  -- same team as well as across teams.
  if v_a_is_gk <> v_b_is_gk
     or (v_a.assigned_position_code = 'GK') <> (v_b.assigned_position_code = 'GK') then
    raise exception 'GK_SWAP_NOT_ALLOWED'
      using hint = 'A goalkeeper cannot be swapped with an outfield player.';
  end if;

  update public.team_assignments
  set team_id = case when id = v_a.id then v_b.team_id else v_a.team_id end,
      assigned_position_code = case when id = v_a.id then v_b.assigned_position_code
                                   else v_a.assigned_position_code end,
      slot_index = case when id = v_a.id then v_b.slot_index else v_a.slot_index end
  where id in (v_a.id, v_b.id);

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
  where ta.match_id = p_match_id;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'teams_swapped', 'match', p_match_id::text, p_match_id,
          jsonb_build_object('player_a', p_player_a, 'player_b', p_player_b));

  return;
end;
$$;

revoke all on function public.swap_team_players(uuid, uuid, uuid) from public;
grant execute on function public.swap_team_players(uuid, uuid, uuid) to authenticated;

commit;
