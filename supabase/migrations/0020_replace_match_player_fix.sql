-- ============================================================================
-- Friday Elite — Migration 0020
-- Fix replace_match_player constraint violations.
--
-- The previous version (1) cancelled the outgoing registration without
-- setting cancelled_at, violating the registrations_cancelled_time check, and
-- (2) reused the outgoing player's queue_position for the incoming player,
-- violating the registrations_unique_queue unique constraint (queue positions
-- are never reused, even after a row is cancelled). Both failures surfaced to
-- the app as a generic "تعذر تنفيذ المبادلة" error.
--
-- This version stamps cancelled_at/cancelled_by on cancellation and gives the
-- incoming player a fresh queue position (max + 1) instead of reusing the
-- outgoing one.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0019.
-- ============================================================================

begin;

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
  v_next_pos    integer;
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

  -- Queue positions are never reused: the incoming player gets a fresh one.
  select coalesce(max(r.queue_position), 0) + 1 into v_next_pos
    from public.registrations r
   where r.match_id = p_match_id;

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

  -- Hand the seat over: cancel the outgoing registration (with cancelled_at,
  -- required by the registrations_cancelled_time check) and confirm the
  -- incoming one at a fresh queue position. (No waitlist promotion: the seat
  -- is immediately refilled by the incoming player.)
  if v_out_reg.id is not null then
    update public.registrations
       set status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = (select auth.uid())
     where id = v_out_reg.id;
  end if;

  if v_in_reg.id is not null then
    update public.registrations
       set status = 'confirmed',
           queue_position = v_next_pos,
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
      v_next_pos,
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
