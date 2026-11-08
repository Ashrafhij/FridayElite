-- ============================================================================
-- Friday Elite — Migration 0028
-- Tolerant phone matching for the public join page.
--
-- Previously the phone lookup / registration matched profiles.phone EXACTLY
-- against the entered number. A player who signed up with +970... (Palestine)
-- could not be found when the admin typed the local 05... (which normalizes
-- to +972...), so the page wrongly reported "not registered".
--
-- public.phone_matches() compares the last 9 significant digits, with an
-- exact match always preferred. The three public join functions use it.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0027.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Tolerant phone comparison: exact match, else same last 9 digits.
-- ----------------------------------------------------------------------------
create or replace function public.phone_matches(p_stored text, p_input text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_stored is not null
    and p_input is not null
    and p_stored <> ''
    and p_input <> ''
    and (
      p_stored = p_input
      or (
        length(regexp_replace(p_stored, '\D', '', 'g')) >= 9
        and length(regexp_replace(p_input, '\D', '', 'g')) >= 9
        and right(regexp_replace(p_stored, '\D', '', 'g'), 9)
          = right(regexp_replace(p_input, '\D', '', 'g'), 9)
      )
    );
$$;

-- ----------------------------------------------------------------------------
-- 2. Phone lookup: tolerant matching (body otherwise same as 0027).
-- ----------------------------------------------------------------------------
drop function if exists public.lookup_player_for_registration(uuid, text);

create function public.lookup_player_for_registration(
  p_match_id uuid,
  p_phone    text
)
returns table (
  player_name        text,
  registration_status text,
  queue_position     integer,
  roster_role        text,
  waitlist_position  integer
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_phone  text := btrim(coalesce(p_phone, ''));
  v_player public.profiles%rowtype;
begin
  if v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'INVALID_PHONE';
  end if;

  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and m.status <> 'draft'
  ) then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  -- External one-time players have no phone, so they can never match here.
  -- Matching is tolerant of country-code/format differences (+970 vs +972
  -- vs local 05...); an exact match always wins when several rows match.
  select * into v_player
  from public.profiles p
  where public.phone_matches(p.phone, v_phone)
  order by (p.phone = v_phone) desc
  limit 1;

  if not found then
    return;
  end if;

  return query
    select
      v_player.full_name,
      rr.status,
      rr.queue_position,
      rr.roster_role,
      case when rr.status = 'waitlisted' then (
        select count(*)::integer
        from public.registrations w
        where w.match_id = p_match_id
          and w.status = 'waitlisted'
          and coalesce(w.roster_role, 'outfield') = coalesce(rr.roster_role, 'outfield')
          and w.queue_position <= rr.queue_position
      ) end
    from (
      select r.status, r.queue_position, r.roster_role
      from public.registrations r
      where r.match_id = p_match_id
        and r.player_id = v_player.id
        and r.status <> 'cancelled'
      order by r.registered_at desc
      limit 1
    ) rr;
end;
$$;

revoke all on function public.lookup_player_for_registration(uuid, text) from public;
grant execute on function public.lookup_player_for_registration(uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Phone registration: tolerant matching (body otherwise same as 0027).
-- ----------------------------------------------------------------------------
drop function if exists public.quick_register_for_match(uuid, text);

create function public.quick_register_for_match(
  p_match_id uuid,
  p_phone    text
)
returns table (
  registration_id    uuid,
  player_name        text,
  registration_status text,
  queue_position     integer,
  roster_role        text,
  already_registered boolean,
  waitlist_position  integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone    text := btrim(coalesce(p_phone, ''));
  v_player   public.profiles%rowtype;
  v_match    public.matches%rowtype;
  v_existing public.registrations%rowtype;
  v_eligible boolean;
  v_role     text;
  v_pos      integer;
  v_status   text;
  v_reg      public.registrations%rowtype;
begin
  if v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'INVALID_PHONE';
  end if;

  select * into v_player
  from public.profiles p
  where public.phone_matches(p.phone, v_phone)
  order by (p.phone = v_phone) desc
  limit 1;

  if not found then
    raise exception 'PLAYER_NOT_FOUND'
      using hint = 'No account uses this phone number.';
  end if;

  -- Pending players are allowed: they can join the match before an admin
  -- approves their access to the rest of the app.
  if v_player.status not in ('pending', 'approved') then
    raise exception 'ACCOUNT_INACTIVE'
      using hint = 'This account cannot register for matches.';
  end if;

  -- Same lock order as register_for_match: the match row serializes every
  -- registration for this match, so capacity and queue numbering cannot race.
  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  if v_match.status not in ('scheduled', 'registration_open') then
    raise exception 'REGISTRATION_CLOSED';
  end if;
  if v_match.registration_locked then
    raise exception 'REGISTRATION_LOCKED';
  end if;
  if now() < v_match.registration_open_at then
    raise exception 'REGISTRATION_NOT_OPEN';
  end if;
  if now() >= v_match.registration_close_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  select * into v_existing
  from public.registrations r
  where r.match_id = p_match_id
    and r.player_id = v_player.id
    and r.status <> 'cancelled'
  order by r.registered_at desc
  limit 1;

  if found then
    return query
      select v_existing.id, v_player.full_name, v_existing.status,
             v_existing.queue_position, v_existing.roster_role, true,
             case when v_existing.status = 'waitlisted' then (
               select count(*)::integer
               from public.registrations w
               where w.match_id = p_match_id
                 and w.status = 'waitlisted'
                 and coalesce(w.roster_role, 'outfield') = coalesce(v_existing.roster_role, 'outfield')
                 and w.queue_position <= v_existing.queue_position
             ) end;
    return;
  end if;

  select e.eligible, e.roster_role into v_eligible, v_role
  from public.roster_eligibility(p_match_id, v_player.id) e;

  select coalesce(max(r.queue_position), 0) + 1 into v_pos
  from public.registrations r
  where r.match_id = p_match_id;

  if v_eligible then
    v_status := 'confirmed';
  else
    v_status := 'waitlisted';
  end if;

  insert into public.registrations
    (match_id, player_id, status, queue_position, roster_role, confirmed_at, source)
  values
    (p_match_id, v_player.id, v_status, v_pos, v_role,
     case when v_status = 'confirmed' then now() else null end,
     'self')
  returning * into v_reg;

  if v_match.status = 'scheduled' then
    update public.matches set status = 'registration_open'
    where id = p_match_id and status = 'scheduled';
  end if;

  insert into public.notifications (player_id, match_id, type, title_ar, body_ar, metadata)
  values (
    v_player.id, p_match_id,
    case when v_status = 'confirmed' then 'registration_confirmed' else 'registration_waitlisted' end,
    case when v_status = 'confirmed' then 'تم تأكيد مقعدك' else 'أنت في قائمة الانتظار' end,
    case when v_status = 'confirmed'
         then 'تم تسجيلك في المباراة عبر رابط التسجيل. نراك يوم الجمعة.'
         when v_role = 'gk'
         then 'اكتمل عدد حراس المرمى، وسيتم ترقيتك تلقائيًا عند توفر مقعد حراسة.'
         else 'اكتمل عدد لاعبي الميدان، وسيتم ترقيتك تلقائيًا عند توفر مقعد.' end,
    jsonb_build_object('queue_position', v_pos, 'status', v_status,
                       'roster_role', v_reg.roster_role, 'via', 'public_link')
  );

  insert into public.audit_log
    (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values
    (v_player.id, 'player', 'registration_created', 'registration', v_reg.id::text, p_match_id,
     jsonb_build_object('status', v_status, 'queue_position', v_pos,
                        'roster_role', v_reg.roster_role, 'via', 'public_link'));

  -- A new confirmed player can change the composition; re-evaluate the
  -- waiting list in the same transaction.
  perform public.promote_waitlist(p_match_id);

  return query
    select v_reg.id, v_player.full_name, v_reg.status,
           v_reg.queue_position, v_reg.roster_role, false,
           case when v_reg.status = 'waitlisted' then (
             select count(*)::integer
             from public.registrations w
             where w.match_id = p_match_id
               and w.status = 'waitlisted'
               and coalesce(w.roster_role, 'outfield') = coalesce(v_reg.roster_role, 'outfield')
               and w.queue_position <= v_reg.queue_position
           ) end;
end;
$$;

revoke all on function public.quick_register_for_match(uuid, text) from public;
grant execute on function public.quick_register_for_match(uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Roster "is this me" mark uses the same tolerant comparison.
-- ----------------------------------------------------------------------------
create or replace function public.get_match_invite_roster(
  p_match_id uuid,
  p_phone    text default null
)
returns table (
  full_name        text,
  jersey_number    smallint,
  position_name_ar text,
  is_gk            boolean,
  is_self          boolean,
  queue_position   integer
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.full_name,
    p.jersey_number,
    prim.name_ar,
    (r.roster_role = 'gk'),
    public.phone_matches(p.phone, nullif(btrim(coalesce(p_phone, '')), '')),
    r.queue_position
  from public.registrations r
  join public.profiles p on p.id = r.player_id
  join public.matches m on m.id = r.match_id
  left join lateral (
    select pos.name_ar
    from public.player_positions pp
    join public.positions pos on pos.code = pp.position_code
    where pp.player_id = p.id
    order by pp.priority
    limit 1
  ) prim on true
  where r.match_id = p_match_id
    and r.status = 'confirmed'
    and m.status <> 'draft'
  order by r.queue_position;
$$;

revoke all on function public.get_match_invite_roster(uuid, text) from public;
grant execute on function public.get_match_invite_roster(uuid, text) to anon, authenticated;

commit;
