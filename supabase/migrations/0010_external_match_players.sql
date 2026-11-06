-- ============================================================================
-- Friday Elite — Migration 0010
-- Admin-added one-time match players (no login/account required).
--
-- External players are stored as hidden roster profile rows for this match only.
-- They cannot sign in, but they can be registered, counted, drawn into teams,
-- shown in match details, appear in result/statistics flows, and be rated.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0009.
-- ============================================================================

begin;

-- Profiles can now contain guest roster entries without an Auth user.
alter table public.profiles
  add column if not exists is_external boolean not null default false;

alter table public.profiles
  add column if not exists external_match_id uuid
  references public.matches (id) on delete cascade;

alter table public.profiles
  alter column phone drop not null;

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.profiles
  drop constraint if exists profiles_guest_phone_check;

alter table public.profiles
  add constraint profiles_guest_phone_check
  check (
    (is_external and phone is null)
    or ((not is_external) and phone is not null)
  );

create index if not exists profiles_external_match_idx
  on public.profiles (external_match_id)
  where is_external;

-- ----------------------------------------------------------------------------
-- Admin-only: add a one-time external player to a specific match.
-- The new row has no phone and no Auth identity; it is created as an approved
-- roster profile, assigned a preferred position if provided, and registered
-- through the normal capacity/roster composition rules.
-- ----------------------------------------------------------------------------
create or replace function public.admin_add_external_player(
  p_match_id       uuid,
  p_full_name      text,
  p_position_code  text default null
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match     public.matches%rowtype;
  v_player_id uuid;
  v_name      text := btrim(p_full_name);
  v_eligible  boolean;
  v_role      text;
  v_pos       integer;
  v_status    text;
  v_reg       public.registrations%rowtype;
begin
  perform public.assert_admin();

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

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'INVALID_EXTERNAL_PLAYER_NAME';
  end if;

  if p_position_code is not null
     and not exists (
       select 1 from public.positions
        where code = btrim(p_position_code) and is_active
     ) then
    raise exception 'INVALID_POSITION';
  end if;

  insert into public.profiles (
    id,
    full_name,
    phone,
    role,
    status,
    approved_at,
    approved_by,
    is_external,
    external_match_id
  )
  values (
    gen_random_uuid(),
    v_name,
    null,
    'user',
    'approved',
    now(),
    (select auth.uid()),
    true,
    p_match_id
  )
  returning id into v_player_id;

  if p_position_code is not null then
    insert into public.player_positions (player_id, position_code, priority)
    values (v_player_id, btrim(p_position_code), 1)
    on conflict (player_id, position_code) do nothing;
  end if;

  select e.eligible, e.roster_role into v_eligible, v_role
    from public.roster_eligibility(p_match_id, v_player_id) e;

  select coalesce(max(r.queue_position), 0) + 1 into v_pos
    from public.registrations r
   where r.match_id = p_match_id;

  if v_eligible then
    v_status := 'confirmed';
  else
    v_status := 'waitlisted';
    v_role := null;
  end if;

  insert into public.registrations (
    match_id,
    player_id,
    status,
    queue_position,
    roster_role,
    confirmed_at,
    source
  )
  values (
    p_match_id,
    v_player_id,
    v_status,
    v_pos,
    case when v_status = 'confirmed' then v_role else null end,
    case when v_status = 'confirmed' then now() else null end,
    'admin'
  )
  returning * into v_reg;

  -- Keep published team assignments from silently becoming stale.
  if exists (select 1 from public.match_teams where match_id = p_match_id) then
    update public.matches
       set teams_stale = true,
           status = case when status = 'teams_published' then 'registration_closed' else status end
     where id = p_match_id;

    perform public.notify_admins(
      p_match_id,
      'teams_stale',
      'تغيّرت قائمة اللاعبين',
      'أضاف الإداري لاعبًا خارجيًا بعد نشر الفرق. أعد توليد الفرق قبل المباراة.'
    );
  end if;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'external_player_added', 'profile', v_player_id::text, p_match_id,
          jsonb_build_object('full_name', v_name, 'position_code', p_position_code, 'status', v_status));

  return v_reg;
end;
$$;

revoke all on function public.admin_add_external_player(uuid, text, text) from public;
grant execute on function public.admin_add_external_player(uuid, text, text) to authenticated;

commit;
