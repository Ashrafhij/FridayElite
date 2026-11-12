-- ============================================================================
-- Friday Elite — Migration 0033
-- Allow players to share the same jersey (shirt) number.
--
-- Removes the unique index on jersey_number among approved players and the
-- JERSEY_TAKEN guards from the admin update and approval RPCs, so multiple
-- players can wear the same number.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0032.
-- ============================================================================

begin;

-- 1. Drop the unique index that prevented duplicate shirt numbers.
drop index if exists public.profiles_unique_jersey;

-- 2. Remove the jersey-number uniqueness guard from admin_update_player.
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
         end
   where id = p_player_id
   returning * into v_target;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values ((select auth.uid()), 'admin', 'player_updated', 'profile', p_player_id::text,
          jsonb_build_object(
            'full_name', v_name,
            'jersey_number', p_jersey_number,
            'preferred_foot', p_preferred_foot,
            'skill_level', p_skill_level,
            'status', p_status,
            'role', p_role,
            'rejection_reason', v_reason,
            'position_codes', p_position_codes,
            'old_status', v_old_status
          ));

  return v_target;
end;
$$;

-- 3. Remove the jersey-number uniqueness guard from approve_player.
create or replace function public.approve_player(p_player_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
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
  if v_target.status = 'approved' then
    raise exception 'ALREADY_APPROVED';
  end if;

  update public.profiles
  set status = 'approved',
      approved_at = now(),
      approved_by = (select auth.uid()),
      rejection_reason = null
  where id = p_player_id
  returning * into v_target;

  insert into public.notifications (player_id, type, title_ar, body_ar)
  values (p_player_id, 'account_approved',
          'تمت الموافقة على حسابك',
          'يمكنك الآن التسجيل في المباريات واختيار مراكزك المفضلة.');

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values ((select auth.uid()), 'admin', 'account_approved', 'profile', p_player_id::text,
          jsonb_build_object('player_id', p_player_id));

  return v_target;
end;
$$;

commit;
