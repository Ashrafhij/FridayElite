-- ============================================================================
-- Friday Elite — Migration 0035
-- Sync registrations and team assignments when a player changes positions.
--
-- When a player changes their preferred positions (via set_my_positions or
-- admin_update_player), also update:
--   * registrations.roster_role for all upcoming matches where they are
--     confirmed or waitlisted, so they appear in the correct pool (GK/outfield)
--   * team_assignments.assigned_position_code for all upcoming matches where
--     they are assigned, using their new primary (first) preferred position
--
-- Run this ONCE in the Supabase SQL editor after 0001-0034.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Helper: sync a player's match roles/positions for all upcoming matches.
-- ----------------------------------------------------------------------------
create or replace function public.sync_player_match_positions(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_primary   text;
  v_new_class     text;
  v_affected      uuid[];
  v_affected_id   uuid;
begin
  -- The player's new roster classification based on saved positions.
  select public.player_roster_class(p_player_id) into v_new_class;

  -- The player's primary (first) preferred position code, if any.
  select pp.position_code into v_new_primary
    from public.player_positions pp
   where pp.player_id = p_player_id
   order by pp.priority asc
   limit 1;

  -- Update registration pool role for upcoming matches.
  -- A gk_and_outfield player who is waitlisted means GK was full when they
  -- registered, so they should move to the outfield queue now that they have
  -- outfield positions. A gk_only player stays in the GK queue.
  update public.registrations r
     set roster_role = case
       when v_new_class = 'gk_only' then 'gk'
       when v_new_class = 'gk_and_outfield' then 'outfield'
       else 'outfield'
     end
   from public.matches m
   where r.match_id = m.id
     and r.player_id = p_player_id
     and r.status in ('confirmed', 'waitlisted')
     and m.status not in ('completed', 'cancelled')
     and m.kickoff_at > now();

  -- Update team assignment position for upcoming matches.
  if v_new_primary is not null then
    update public.team_assignments ta
       set assigned_position_code = v_new_primary
     from public.matches m
    where ta.match_id = m.id
      and ta.player_id = p_player_id
      and m.status not in ('completed', 'cancelled')
      and m.kickoff_at > now();
  end if;

  -- Re-evaluate waiting lists for affected matches so players can be promoted
  -- if seats opened up (e.g. a GK cancellation now frees a spot, or an
  -- outfield seat is available for a player who just added outfield positions).
  select array_agg(distinct m.id) into v_affected
    from public.registrations r
    join public.matches m on m.id = r.match_id
   where r.player_id = p_player_id
     and r.status in ('confirmed', 'waitlisted')
     and m.status not in ('completed', 'cancelled')
     and m.kickoff_at > now();

  if v_affected is not null then
    foreach v_affected_id in array v_affected loop
      perform public.promote_waitlist(v_affected_id);
      update public.matches
         set teams_stale = true
       where id = v_affected_id;
    end loop;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. set_my_positions — sync match positions after the player saves positions.
-- ----------------------------------------------------------------------------
create or replace function public.set_my_positions(p_position_codes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_code text;
  v_seen text[] := '{}';
  v_i    integer := 0;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if not public.can_manage_own_profile() then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  if p_position_codes is null
     or array_length(p_position_codes, 1) is null
     or array_length(p_position_codes, 1) = 0 then
    raise exception 'POSITIONS_REQUIRED';
  end if;

  if array_length(p_position_codes, 1) > 5 then
    raise exception 'TOO_MANY_POSITIONS';
  end if;

  foreach v_code in array p_position_codes loop
    v_code := btrim(v_code);
    if not exists (select 1 from public.positions pos where pos.code = v_code and pos.is_active) then
      raise exception 'INVALID_POSITION' using hint = v_code;
    end if;
    if v_code = any (v_seen) then
      raise exception 'DUPLICATE_POSITION' using hint = v_code;
    end if;
    v_seen := v_seen || v_code;
  end loop;

  delete from public.player_positions where player_id = v_uid;

  foreach v_code in array p_position_codes loop
    v_i := v_i + 1;
    insert into public.player_positions (player_id, position_code, priority)
    values (v_uid, btrim(v_code), v_i);
  end loop;

  -- Sync the player's registrations and team assignments for upcoming matches.
  perform public.sync_player_match_positions(v_uid);

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values (v_uid, 'player', 'positions_updated', 'profile', v_uid::text,
          jsonb_build_object('positions', to_jsonb(p_position_codes)));
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. admin_update_player — also sync registration pool role (roster_role).
--    Team assignment sync was already added in migration 0034.
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_player(
  p_player_id        uuid,
  p_full_name        text,
  p_jersey_number    smallint,
  p_preferred_foot   text,
  p_skill_level      smallint,
  p_status           text,
  p_role             text,
  p_rejection_reason text,
  p_position_codes   text[]
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target     public.profiles%rowtype;
  v_old_status text;
  v_name       text := btrim(p_full_name);
  v_reason     text := nullif(btrim(p_rejection_reason), '');
  v_code       text;
  v_seen       text[] := '{}';
  v_i          integer := 0;
  v_reg        record;
  v_new_primary text;
  v_affected_match_ids uuid[];
begin
  perform public.assert_admin();

  if p_player_id = (select auth.uid()) then
    raise exception 'CANNOT_MODIFY_SELF';
  end if;

  select * into v_target from public.profiles where id = p_player_id for update;
  if not found then
    raise exception 'PLAYER_NOT_FOUND';
  end if;
  if v_target.role = 'admin' then
    raise exception 'CANNOT_MODIFY_ADMIN';
  end if;

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'INVALID_NAME';
  end if;

  if p_jersey_number is not null and (p_jersey_number < 1 or p_jersey_number > 99) then
    raise exception 'INVALID_JERSEY_NUMBER';
  end if;

  if p_preferred_foot is not null and p_preferred_foot not in ('right', 'left', 'both') then
    raise exception 'INVALID_PREFERRED_FOOT';
  end if;

  if p_skill_level is not null and (p_skill_level < 1 or p_skill_level > 5) then
    raise exception 'INVALID_SKILL_LEVEL';
  end if;

  if p_status not in ('pending', 'approved', 'rejected', 'suspended') then
    raise exception 'INVALID_STATUS';
  end if;

  if p_role not in ('admin', 'player', 'user') then
    raise exception 'INVALID_ROLE';
  end if;

  if p_position_codes is not null and array_length(p_position_codes, 1) > 5 then
    raise exception 'TOO_MANY_POSITIONS';
  end if;

  if p_position_codes is not null then
    foreach v_code in array p_position_codes loop
      v_code := btrim(v_code);
      if not exists (
        select 1 from public.positions
         where code = v_code and is_active
      ) then
        raise exception 'INVALID_POSITION' using hint = v_code;
      end if;
      if v_code = any (v_seen) then
        raise exception 'DUPLICATE_POSITION' using hint = v_code;
      end if;
      v_seen := v_seen || v_code;
    end loop;
  end if;

  v_old_status := v_target.status;

  update public.profiles
     set full_name        = v_name,
         jersey_number    = p_jersey_number,
         preferred_foot   = p_preferred_foot,
         skill_level      = p_skill_level,
         status           = p_status,
         role             = p_role,
         rejection_reason = case
           when p_status = 'approved' then null
           when p_status = 'pending' then null
           else v_reason
         end,
         approved_at      = case
           when p_status = 'approved' then coalesce(approved_at, now())
           when p_status = 'pending' then null
           else approved_at
         end,
         approved_by      = case
           when p_status = 'approved' then coalesce(approved_by, (select auth.uid()))
           when p_status = 'pending' then null
           else approved_by
         end
   where id = p_player_id
   returning * into v_target;

  -- Ordered position preferences (admin replaces them wholesale; null keeps
  -- them, an empty array clears them).
  if p_position_codes is not null then
    delete from public.player_positions where player_id = p_player_id;

    foreach v_code in array p_position_codes loop
      v_i := v_i + 1;
      insert into public.player_positions (player_id, position_code, priority)
      values (p_player_id, btrim(v_code), v_i);
    end loop;
  end if;

  -- Sync registrations and team assignments for upcoming matches.
  perform public.sync_player_match_positions(p_player_id);

  -- Losing the approved status releases active registrations so the player
  -- can no longer play upcoming matches.
  if v_old_status = 'approved' and p_status <> 'approved' then
    for v_reg in
      select r.id
        from public.registrations r
        join public.matches m on m.id = r.match_id
       where r.player_id = p_player_id
         and r.status <> 'cancelled'
         and m.status not in ('completed', 'cancelled')
    loop
      perform public.cancel_registration(v_reg.id);
    end loop;
  end if;

  if p_status = 'approved' and v_old_status <> 'approved' then
    insert into public.notifications (player_id, type, title_ar, body_ar)
    values (p_player_id, 'account_approved',
            'تمت الموافقة على حسابك',
            'يمكنك الآن التسجيل في المباريات واختيار مراكزك المفضلة.');
  elsif p_status = 'rejected' and v_old_status <> 'rejected' then
    insert into public.notifications (player_id, type, title_ar, body_ar)
    values (p_player_id, 'account_rejected',
            'لم تتم الموافقة على الحساب',
            coalesce(v_reason, 'يرجى التواصل مع إدارة المجموعة.'));
  elsif p_status = 'suspended' and v_old_status <> 'suspended' then
    insert into public.notifications (player_id, type, title_ar, body_ar)
    values (p_player_id, 'account_suspended',
            'تم تعليق حسابك',
            coalesce(v_reason, 'يرجى التواصل مع إدارة المجموعة.'));
  end if;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'admin_profile_updated', 'profile', p_player_id::text, null,
          jsonb_build_object(
            'full_name', v_name,
            'jersey_number', p_jersey_number,
            'preferred_foot', p_preferred_foot,
            'skill_level', p_skill_level,
            'status', p_status,
            'old_status', v_old_status,
            'role', p_role,
            'position_codes', p_position_codes
          ));

  return v_target;
end;
$$;

commit;
