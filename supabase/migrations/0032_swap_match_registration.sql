-- ============================================================================
-- Friday Elite — Migration 0032
-- Admin swap: exchange a confirmed player with a waitlisted player.
--
-- Adds public.swap_match_registration(p_match_id, p_out_player_id, p_in_player_id):
-- - p_out_player_id: a confirmed registration (gives up the seat)
-- - p_in_player_id: a waitlisted registration (takes the seat)
--
-- The two registrations swap status, queue position and roster role, so the
-- waitlist order is preserved and capacity is unchanged. A goalkeeper seat can
-- only be exchanged with a goalkeeper-role player, and an outfield seat with
-- an outfield-role player.
--
-- Blocked when the match is cancelled or completed. Requires admin.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0031.
-- ============================================================================

begin;

create or replace function public.swap_match_registration(
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
  v_match     public.matches%rowtype;
  v_out_reg   public.registrations%rowtype;
  v_in_reg    public.registrations%rowtype;
  v_out_is_gk boolean;
  v_in_is_gk  boolean;
begin
  perform public.assert_admin();

  if p_out_player_id = p_in_player_id then
    raise exception 'SAME_PLAYER';
  end if;

  select * into v_match
    from public.matches
   where id = p_match_id
    for update;

  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  if v_match.status in ('cancelled', 'completed') then
    raise exception 'MATCH_CLOSED';
  end if;

  -- The outgoing player must be confirmed.
  select * into v_out_reg
    from public.registrations
   where match_id = p_match_id
     and player_id = p_out_player_id
     and status = 'confirmed'
    for update;

  if not found then
    raise exception 'OUT_PLAYER_NOT_CONFIRMED'
      using hint = 'اللاعب المغادر يجب أن يكون مؤكدًا.';
  end if;

  -- The incoming player must be waitlisted.
  select * into v_in_reg
    from public.registrations
   where match_id = p_match_id
     and player_id = p_in_player_id
     and status = 'waitlisted'
    for update;

  if not found then
    raise exception 'IN_PLAYER_NOT_WAITLISTED'
      using hint = 'اللاعب الداخل يجب أن يكون في قائمة الانتظار.';
  end if;

  -- Role compatibility: a GK seat can only be taken by a GK-role player, and
  -- an outfield seat never by a GK-role player.
  v_out_is_gk := (coalesce(v_out_reg.roster_role, 'outfield') = 'gk');
  v_in_is_gk := (coalesce(v_in_reg.roster_role, 'outfield') = 'gk');

  if v_out_is_gk <> v_in_is_gk then
    raise exception 'ROLE_MISMATCH'
      using hint = 'مقعد حارس المرمى لا يمكن استبداله إلا بلاعب حراسة، ومقعد الميدان لا يمكن استبداله إلا بلاعب ميدان.';
  end if;

  -- Swap status, queue position and roster role. Confirmed count stays the
  -- same, so no capacity or promotion side effects are needed.
  update public.registrations
     set status = 'waitlisted',
         confirmed_at = null,
         promoted_at = null,
         queue_position = v_in_reg.queue_position,
         roster_role = coalesce(v_in_reg.roster_role, 'outfield')
   where id = v_out_reg.id;

  update public.registrations
     set status = 'confirmed',
         confirmed_at = coalesce(confirmed_at, now()),
         promoted_at = now(),
         queue_position = v_out_reg.queue_position,
         roster_role = coalesce(v_out_reg.roster_role, 'outfield')
   where id = v_in_reg.id;

  insert into public.audit_log (
    actor_id, actor_role, action, entity, entity_id, match_id, payload
  )
  values (
    (select auth.uid()), 'admin', 'registration_swapped', 'registration',
    v_match.id::text, p_match_id,
    jsonb_build_object(
      'out_player_id', p_out_player_id,
      'in_player_id', p_in_player_id,
      'out_queue_position', v_out_reg.queue_position,
      'in_queue_position', v_in_reg.queue_position,
      'roster_role', coalesce(v_out_reg.roster_role, 'outfield')
    )
  );

  return;
end;
$$;

revoke all on function public.swap_match_registration(uuid, uuid, uuid) from public;
grant execute on function public.swap_match_registration(uuid, uuid, uuid) to authenticated;

commit;
