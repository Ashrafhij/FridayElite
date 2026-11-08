-- ============================================================================
-- Friday Elite — Migration 0025
-- Public "join match" links: register by phone without signing in.
--
-- The admin shares one link per match (#/join/<match_id>). The player:
--   1. sees the match summary             -> get_match_invite()
--   2. enters their phone number          -> lookup_player_for_registration()
--   3. sees their name and taps "تسجيل"    -> quick_register_for_match()
--
-- Only registration is public. Cancelling still requires the player to sign in
-- (or an admin). Pending accounts may register, so a brand-new player can join
-- the match before an admin approves their app access.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0024.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Public match summary for the join page. Never exposes player data.
-- ----------------------------------------------------------------------------
create or replace function public.get_match_invite(p_match_id uuid)
returns table (
  id                    uuid,
  local_date            date,
  kickoff_at            timestamptz,
  venue                 text,
  address               text,
  capacity              smallint,
  confirmed_count       integer,
  waitlist_count        integer,
  match_status          text,
  registration_open_at  timestamptz,
  registration_close_at timestamptz,
  registration_locked   boolean,
  registration_state    text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    m.id,
    m.local_date,
    m.kickoff_at,
    m.venue,
    m.address,
    m.capacity,
    coalesce(rc.confirmed, 0)::integer,
    coalesce(rc.waitlisted, 0)::integer,
    m.status,
    m.registration_open_at,
    m.registration_close_at,
    m.registration_locked,
    case
      when m.status in ('draft', 'completed', 'cancelled') then 'closed'
      when m.registration_locked then 'locked'
      when m.status not in ('scheduled', 'registration_open') then 'closed'
      when now() < m.registration_open_at then 'not_open'
      when now() >= m.registration_close_at then 'closed'
      else 'open'
    end
  from public.matches m
  left join lateral (
    select
      count(*) filter (where r.status = 'confirmed') as confirmed,
      count(*) filter (where r.status = 'waitlisted') as waitlisted
    from public.registrations r
    where r.match_id = m.id
  ) rc on true
  where m.id = p_match_id
    and m.status <> 'draft';
$$;

-- ----------------------------------------------------------------------------
-- Resolve a phone number to a player name and their current registration.
-- Returns zero rows when the phone is not registered.
-- ----------------------------------------------------------------------------
create or replace function public.lookup_player_for_registration(
  p_match_id uuid,
  p_phone    text
)
returns table (
  player_name         text,
  registration_status text,
  queue_position      integer,
  roster_role         text
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
  select * into v_player
  from public.profiles p
  where p.phone = v_phone
  limit 1;

  if not found then
    return;
  end if;

  return query
    select
      v_player.full_name,
      (
        select r.status
        from public.registrations r
        where r.match_id = p_match_id
          and r.player_id = v_player.id
          and r.status <> 'cancelled'
        order by r.registered_at desc
        limit 1
      ),
      (
        select r.queue_position
        from public.registrations r
        where r.match_id = p_match_id
          and r.player_id = v_player.id
          and r.status <> 'cancelled'
        order by r.registered_at desc
        limit 1
      ),
      (
        select r.roster_role
        from public.registrations r
        where r.match_id = p_match_id
          and r.player_id = v_player.id
          and r.status <> 'cancelled'
        order by r.registered_at desc
        limit 1
      );
end;
$$;

-- ----------------------------------------------------------------------------
-- Register by phone (idempotent: an existing registration is returned as-is).
-- Mirrors register_for_match(): same capacity, window and waitlist rules.
-- ----------------------------------------------------------------------------
create or replace function public.quick_register_for_match(
  p_match_id uuid,
  p_phone    text
)
returns table (
  registration_id    uuid,
  player_name        text,
  registration_status text,
  queue_position     integer,
  roster_role        text,
  already_registered boolean
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
  where p.phone = v_phone
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
             v_existing.queue_position, v_existing.roster_role, true;
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
    v_role := null;
  end if;

  insert into public.registrations
    (match_id, player_id, status, queue_position, roster_role, confirmed_at, source)
  values
    (p_match_id, v_player.id, v_status, v_pos,
     case when v_status = 'confirmed' then v_role else null end,
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
         else 'اكتمل العدد، وسيتم ترقيتك تلقائيًا عند توفر مقعد.' end,
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
           v_reg.queue_position, v_reg.roster_role, false;
end;
$$;

revoke all on function public.get_match_invite(uuid) from public;
grant execute on function public.get_match_invite(uuid) to anon, authenticated;

revoke all on function public.lookup_player_for_registration(uuid, text) from public;
grant execute on function public.lookup_player_for_registration(uuid, text) to anon, authenticated;

revoke all on function public.quick_register_for_match(uuid, text) from public;
grant execute on function public.quick_register_for_match(uuid, text) to anon, authenticated;

commit;
