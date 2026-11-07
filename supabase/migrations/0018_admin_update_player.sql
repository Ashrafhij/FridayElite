-- ============================================================================
-- Friday Elite — Migration 0018
-- Admin can view and edit any player's full profile (including pending
-- accounts that have not been accepted yet).
--
-- Adds public.admin_update_player(...): updates name, shirt number, preferred
-- foot, skill level, account status (with approval/rejection bookkeeping and
-- notifications), role, rejection reason, and ordered position preferences
-- for any non-admin player. Phone is intentionally not editable: it is the
-- login identity and is managed through Auth.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0017.
-- ============================================================================

begin;

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

  -- Shirt numbers are unique among approved players.
  if p_status = 'approved' and p_jersey_number is not null and exists (
    select 1
      from public.profiles p
     where p.id <> p_player_id
       and p.status = 'approved'
       and p.jersey_number = p_jersey_number
  ) then
    raise exception 'JERSEY_TAKEN';
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

  -- Losing the approved status releases active registrations (mirrors
  -- suspend_player) so the player can no longer play upcoming matches.
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

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values ((select auth.uid()), 'admin', 'admin_profile_updated', 'profile', p_player_id::text,
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

revoke all on function public.admin_update_player(uuid, text, smallint, text, smallint, text, text, text, text[]) from public;
grant execute on function public.admin_update_player(uuid, text, smallint, text, smallint, text, text, text, text[]) to authenticated;

commit;
