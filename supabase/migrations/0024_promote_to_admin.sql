-- ============================================================================
-- Friday Elite — Migration 0024
-- Admins can promote an existing player to admin from the admin page.
--
-- Adds public.promote_to_admin(p_player_id): sets role='admin' and approves
-- the account (an approvable pending account becomes approved + admin).
-- Admins are identified by role='admin' + status='approved', so the target
-- gains full admin rights on next session use. Existing admins cannot be
-- edited or demoted through this function.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0023.
-- ============================================================================

begin;

create or replace function public.promote_to_admin(p_player_id uuid)
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
    raise exception 'ALREADY_ADMIN';
  end if;
  if v_target.is_external then
    raise exception 'PLAYER_NOT_ELIGIBLE'
      using hint = 'One-time external players cannot be admins.';
  end if;

  update public.profiles
     set role = 'admin',
         status = 'approved',
         approved_at = coalesce(approved_at, now()),
         approved_by = coalesce(approved_by, (select auth.uid())),
         rejection_reason = null
   where id = p_player_id
   returning * into v_target;

  insert into public.notifications (player_id, type, title_ar, body_ar)
  values (p_player_id, 'account_approved',
          'تم تعيينك كمدير',
          'أصبح حسابك مسؤولًا في إدارة المجموعة.');

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values ((select auth.uid()), 'admin', 'admin_promoted', 'profile', p_player_id::text,
          jsonb_build_object('player_id', p_player_id));

  return v_target;
end;
$$;

revoke all on function public.promote_to_admin(uuid) from public;
grant execute on function public.promote_to_admin(uuid) to authenticated;

commit;
