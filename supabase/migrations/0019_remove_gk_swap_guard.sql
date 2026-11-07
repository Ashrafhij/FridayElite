-- ============================================================================
-- Friday Elite — Migration 0019
-- Admin override: remove the goalkeeper guard from swaps and replacements.
--
-- Previously, swap_team_players and replace_match_player refused to move a
-- GK-role player (or a GK slot) with an outfield player
-- (GK_SWAP_NOT_ALLOWED). From now on the admin's choice is applied as-is:
-- any assigned player can be swapped with, or replaced by, any other player
-- regardless of positions/roles.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0018.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- swap_team_players without the GK guard
-- ----------------------------------------------------------------------------
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

  -- Admin override: no goalkeeper/position guard. The admin decides.
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

-- ----------------------------------------------------------------------------
-- replace_match_player without the GK guard
-- ----------------------------------------------------------------------------
create or replace function public.replace_match_player(
  p_match_id       uuid,
  p_out_player_id  uuid,
  p_in_player_id   uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match       public.matches%rowtype;
  v_out         public.team_assignments%rowtype;
  v_in_profile  public.profiles%rowtype;
  v_in_reg      public.registrations%rowtype;
  v_out_reg     public.registrations%rowtype;
begin
  perform public.assert_admin();

  if p_out_player_id = p_in_player_id then
    raise exception 'SAME_PLAYER';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status = 'cancelled' then
    raise exception 'MATCH_CLOSED';
  end if;

  select * into v_out from public.team_assignments
   where match_id = p_match_id and player_id = p_out_player_id
    for update;
  if not found then
    raise exception 'ASSIGNMENT_NOT_FOUND';
  end if;

  select * into v_in_profile from public.profiles where id = p_in_player_id;
  if not found then
    raise exception 'PLAYER_NOT_FOUND';
  end if;
  if v_in_profile.is_external then
    raise exception 'PLAYER_NOT_ELIGIBLE'
      using hint = 'One-time external players must be added with admin_add_external_player.';
  end if;
  if v_in_profile.status <> 'approved' then
    raise exception 'PLAYER_NOT_ELIGIBLE';
  end if;

  if exists (
    select 1 from public.team_assignments
     where match_id = p_match_id and player_id = p_in_player_id
  ) then
    raise exception 'PLAYER_ALREADY_ASSIGNED';
  end if;

  select * into v_out_reg
    from public.registrations
   where match_id = p_match_id and player_id = p_out_player_id
     and status = 'confirmed'
    for update;

  select * into v_in_reg
    from public.registrations
   where match_id = p_match_id and player_id = p_in_player_id
    for update;

  -- Admin override: no goalkeeper/position guard. The admin decides.

  -- The incoming player takes over the outgoing player's pitch slot.
  update public.team_assignments
     set player_id = p_in_player_id
   where id = v_out.id;

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

  -- Hand the seat over: cancel the outgoing registration and confirm the
  -- incoming one with the same queue position and roster role. (No waitlist
  -- promotion: the seat is immediately refilled by the incoming player.)
  if v_out_reg.id is not null then
    update public.registrations
       set status = 'cancelled'
     where id = v_out_reg.id;
  end if;

  if v_in_reg.id is not null then
    update public.registrations
       set status = 'confirmed',
           queue_position = coalesce(v_out_reg.queue_position, v_in_reg.queue_position),
           roster_role = coalesce(v_out_reg.roster_role, v_in_reg.roster_role, 'outfield'),
           confirmed_at = coalesce(confirmed_at, now())
     where id = v_in_reg.id;
  else
    insert into public.registrations (
      match_id, player_id, status, queue_position, roster_role, confirmed_at, source
    )
    values (
      p_match_id,
      p_in_player_id,
      'confirmed',
      coalesce(v_out_reg.queue_position, 0),
      coalesce(v_out_reg.roster_role, 'outfield'),
      now(),
      'admin'
    );
  end if;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'match_player_replaced', 'match', p_match_id::text, p_match_id,
          jsonb_build_object('out_player_id', p_out_player_id, 'in_player_id', p_in_player_id));

  return;
end;
$$;

revoke all on function public.replace_match_player(uuid, uuid, uuid) from public;
grant execute on function public.replace_match_player(uuid, uuid, uuid) to authenticated;

commit;
