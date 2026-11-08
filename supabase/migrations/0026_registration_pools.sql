-- ============================================================================
-- Friday Elite — Migration 0026
-- Separate registration pools for outfield players and goalkeepers.
--
-- New rules:
--   * The first 16 outfield players are confirmed.
--   * Every later outfield player joins the outfield waiting list (FIFO).
--   * The first 2 goalkeepers are confirmed.
--   * Every later goalkeeper joins the goalkeeper waiting list (FIFO).
--   * An outfield cancellation promotes the first outfield waitlister only.
--   * A goalkeeper cancellation promotes the first goalkeeper waitlister only.
--
-- To make the queues unambiguous (and displayable), waitlisted rows now store
-- the pool they are waiting in inside roster_role ('gk' or 'outfield'). The
-- role is no longer only a confirmed-player snapshot.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0025.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Allow waitlisted registrations to carry their queue role.
-- ----------------------------------------------------------------------------
alter table public.registrations
  drop constraint if exists registrations_role_consistency;

-- Backfill existing waitlisted rows. Dual-role players (GK + outfield) are
-- placed in the outfield queue because it has sixteen seats instead of two.
update public.registrations r
set roster_role = case
  when public.player_roster_class(r.player_id) = 'gk_only' then 'gk'
  else 'outfield'
end
where r.status = 'waitlisted'
  and r.roster_role is null;

alter table public.registrations
  add constraint registrations_role_consistency check (
    (status = 'confirmed' and roster_role is not null)
    or (status = 'waitlisted' and roster_role is not null)
    or status = 'cancelled'
  );

comment on column public.registrations.roster_role is
  'Confirmed: pitch role (gk/outfield). Waitlisted: the queue the player is waiting in (gk/outfield). Cancelled: historical role.';

-- Promote by pool, so index the two waiting queues separately.
create index if not exists registrations_match_waitlist_role_idx
  on public.registrations (match_id, roster_role, queue_position)
  where status = 'waitlisted';

-- ----------------------------------------------------------------------------
-- 2. Eligibility: 16 outfield seats and 2 goalkeeper seats, independently.
-- ----------------------------------------------------------------------------
create or replace function public.roster_eligibility(
  p_match_id  uuid,
  p_player_id uuid,
  out eligible boolean,
  out roster_role text
)
returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_capacity       integer;
  v_gk             integer;
  v_outfield       integer;
  v_gk_limit       integer := 2;
  v_outfield_limit integer;
  v_class          text;
begin
  select m.capacity into v_capacity
  from public.matches m
  where m.id = p_match_id;

  if v_capacity is null then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  -- Standard squad: 16 outfield + 2 goalkeepers. Smaller match capacities
  -- shrink the outfield pool first, while reserving up to two GK seats.
  v_outfield_limit := least(16, greatest(v_capacity - v_gk_limit, 0));

  select rc.gk, rc.outfield into v_gk, v_outfield
  from public.roster_counts(p_match_id) rc;

  v_class := public.player_roster_class(p_player_id);

  -- GK-only players always queue for a goalkeeper seat. Dual-role players take
  -- an open goalkeeper seat first; otherwise they compete for an outfield seat.
  -- Everyone else is an outfield player.
  if v_class = 'gk_only'
     or (v_class = 'gk_and_outfield' and v_gk < v_gk_limit) then
    roster_role := 'gk';
  else
    roster_role := 'outfield';
  end if;

  if v_gk + v_outfield >= v_capacity then
    eligible := false;
  elsif roster_role = 'gk' then
    eligible := v_gk < v_gk_limit;
  else
    eligible := v_outfield < v_outfield_limit;
  end if;

  return;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Promotion: each pool has its own FIFO queue.
-- ----------------------------------------------------------------------------
create or replace function public.promote_waitlist(p_match_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_capacity       integer;
  v_gk             integer;
  v_outfield       integer;
  v_gk_limit       integer := 2;
  v_outfield_limit integer;
  v_role           text;
  v_next           public.registrations%rowtype;
  v_found          boolean;
  v_actor          uuid := (select auth.uid());
  v_actor_role     text;
  v_promoted       integer := 0;
  v_i              integer;
begin
  -- Lock order is always: match row first, then registration rows.
  select m.capacity into v_capacity
  from public.matches m
  where m.id = p_match_id
  for update;

  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  v_outfield_limit := least(16, greatest(v_capacity - v_gk_limit, 0));

  v_actor_role := case
    when v_actor is null then 'system'
    when public.is_admin() then 'admin'
    else 'player'
  end;

  for v_i in 1 .. v_capacity loop
    select rc.gk, rc.outfield into v_gk, v_outfield
    from public.roster_counts(p_match_id) rc;

    exit when v_gk + v_outfield >= v_capacity;

    v_role := null;
    v_found := false;

    -- Goalkeeper queue: only players who registered as goalkeepers.
    if v_gk < v_gk_limit then
      select r.* into v_next
      from public.registrations r
      join public.profiles p on p.id = r.player_id
      where r.match_id = p_match_id
        and r.status = 'waitlisted'
        and p.status = 'approved'
        and r.roster_role = 'gk'
      order by r.queue_position
      limit 1
      for update of r;

      if found then
        v_role := 'gk';
        v_found := true;
      end if;
    end if;

    -- Outfield queue: only players who registered as outfield players.
    if not v_found and v_outfield < v_outfield_limit then
      select r.* into v_next
      from public.registrations r
      join public.profiles p on p.id = r.player_id
      where r.match_id = p_match_id
        and r.status = 'waitlisted'
        and p.status = 'approved'
        and r.roster_role = 'outfield'
      order by r.queue_position
      limit 1
      for update of r;

      if found then
        v_role := 'outfield';
        v_found := true;
      end if;
    end if;

    exit when not v_found;

    update public.registrations
    set status = 'confirmed',
        confirmed_at = now(),
        promoted_at = now(),
        roster_role = v_role
    where id = v_next.id
    returning * into v_next;

    insert into public.notifications (player_id, match_id, type, title_ar, body_ar, metadata)
    values (
      v_next.player_id, p_match_id, 'registration_promoted',
      'تمت ترقيتك إلى قائمة المؤكدين',
      case when v_role = 'gk'
           then 'توفّر مقعد حراسة، وأصبح تسجيلك مؤكدًا كحارس مرمى. نراك يوم الجمعة.'
           else 'توفّر مقعد، وأصبح تسجيلك مؤكدًا. نراك يوم الجمعة.' end,
      jsonb_build_object('queue_position', v_next.queue_position,
                         'roster_role', v_role)
    );

    insert into public.audit_log
      (actor_id, actor_role, action, entity, entity_id, match_id, payload)
    values
      (v_actor, v_actor_role, 'registration_promoted', 'registration',
       v_next.id::text, p_match_id,
       jsonb_build_object('promoted_player', v_next.player_id,
                          'queue_position', v_next.queue_position,
                          'roster_role', v_role));

    v_promoted := v_promoted + 1;
  end loop;

  return v_promoted;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Registration functions: store the queue role on waitlisted rows too.
-- ----------------------------------------------------------------------------
create or replace function public.register_for_match(p_match_id uuid)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_match    public.matches%rowtype;
  v_eligible boolean;
  v_role     text;
  v_pos      integer;
  v_status   text;
  v_reg      public.registrations%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  -- Account approval gate (checked on the server, not in React).
  if not public.is_approved() then
    raise exception 'ACCOUNT_NOT_APPROVED'
      using hint = 'Your account must be approved by an administrator.';
  end if;

  -- Serialize every registration/cancellation for this match.
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

  if exists (
    select 1 from public.registrations r
    where r.match_id = p_match_id
      and r.player_id = v_uid
      and r.status <> 'cancelled'
  ) then
    raise exception 'ALREADY_REGISTERED';
  end if;

  select e.eligible, e.roster_role into v_eligible, v_role
  from public.roster_eligibility(p_match_id, v_uid) e;

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
    (p_match_id, v_uid, v_status, v_pos, v_role,
     case when v_status = 'confirmed' then now() else null end,
     'self')
  returning * into v_reg;

  if v_match.status = 'scheduled' then
    update public.matches set status = 'registration_open'
    where id = p_match_id and status = 'scheduled';
  end if;

  insert into public.notifications (player_id, match_id, type, title_ar, body_ar, metadata)
  values (
    v_uid, p_match_id,
    case when v_status = 'confirmed' then 'registration_confirmed' else 'registration_waitlisted' end,
    case when v_status = 'confirmed' then 'تم تأكيد مقعدك' else 'أنت في قائمة الانتظار' end,
    case when v_status = 'confirmed'
         then 'تم تسجيلك في المباراة. نراك يوم الجمعة.'
         when v_role = 'gk'
         then 'اكتمل عدد حراس المرمى، وسيتم ترقيتك تلقائيًا عند توفر مقعد حراسة.'
         else 'اكتمل عدد لاعبي الميدان، وسيتم ترقيتك تلقائيًا عند توفر مقعد.' end,
    jsonb_build_object('queue_position', v_pos, 'status', v_status,
                       'roster_role', v_reg.roster_role)
  );

  insert into public.audit_log
    (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values
    (v_uid, 'player', 'registration_created', 'registration', v_reg.id::text, p_match_id,
     jsonb_build_object('status', v_status, 'queue_position', v_pos,
                        'roster_role', v_reg.roster_role));

  -- A new confirmed player can change the composition; re-evaluate the
  -- waiting list in the same transaction.
  perform public.promote_waitlist(p_match_id);

  return v_reg;
end;
$$;

create or replace function public.admin_add_registration(
  p_match_id  uuid,
  p_player_id uuid
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match    public.matches%rowtype;
  v_player   public.profiles%rowtype;
  v_eligible boolean;
  v_role     text;
  v_pos      integer;
  v_status   text;
  v_reg      public.registrations%rowtype;
begin
  perform public.assert_admin();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status in ('cancelled', 'completed') then
    raise exception 'MATCH_CLOSED';
  end if;

  select * into v_player from public.profiles where id = p_player_id;
  if not found or v_player.status <> 'approved' then
    raise exception 'PLAYER_NOT_APPROVED';
  end if;

  if exists (
    select 1 from public.registrations r
    where r.match_id = p_match_id and r.player_id = p_player_id and r.status <> 'cancelled'
  ) then
    raise exception 'ALREADY_REGISTERED';
  end if;

  select e.eligible, e.roster_role into v_eligible, v_role
  from public.roster_eligibility(p_match_id, p_player_id) e;

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
    (p_match_id, p_player_id, v_status, v_pos, v_role,
     case when v_status = 'confirmed' then now() else null end,
     'admin')
  returning * into v_reg;

  insert into public.notifications (player_id, match_id, type, title_ar, body_ar, metadata)
  values (
    p_player_id, p_match_id,
    case when v_status = 'confirmed' then 'registration_confirmed' else 'registration_waitlisted' end,
    case when v_status = 'confirmed' then 'تم تسجيلك في المباراة' else 'تمت إضافتك لقائمة الانتظار' end,
    'أضافك مدير المجموعة إلى المباراة.',
    jsonb_build_object('queue_position', v_pos, 'status', v_status,
                       'source', 'admin', 'roster_role', v_reg.roster_role)
  );

  if exists (select 1 from public.match_teams t where t.match_id = p_match_id) then
    update public.matches set teams_stale = true where id = p_match_id;
  end if;

  insert into public.audit_log
    (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values
    ((select auth.uid()), 'admin', 'registration_added_by_admin', 'registration',
     v_reg.id::text, p_match_id,
     jsonb_build_object('player_id', p_player_id, 'status', v_status,
                        'queue_position', v_pos, 'roster_role', v_reg.roster_role));

  -- Keep the waiting list in sync after an admin-added player.
  perform public.promote_waitlist(p_match_id);

  return v_reg;
end;
$$;

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
    v_role,
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
           v_reg.queue_position, v_reg.roster_role, false;
end;
$$;

revoke all on function public.quick_register_for_match(uuid, text) from public;
grant execute on function public.quick_register_for_match(uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Public invite summary now exposes per-pool counts.
-- ----------------------------------------------------------------------------
drop function if exists public.get_match_invite(uuid);

create function public.get_match_invite(p_match_id uuid)
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
  registration_state    text,
  gk_confirmed          integer,
  outfield_confirmed    integer,
  gk_waitlist           integer,
  outfield_waitlist     integer
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
    end,
    coalesce(rc.gk_confirmed, 0)::integer,
    coalesce(rc.outfield_confirmed, 0)::integer,
    coalesce(rc.gk_waitlist, 0)::integer,
    coalesce(rc.outfield_waitlist, 0)::integer
  from public.matches m
  left join lateral (
    select
      count(*) filter (where r.status = 'confirmed') as confirmed,
      count(*) filter (where r.status = 'waitlisted') as waitlisted,
      count(*) filter (where r.status = 'confirmed' and r.roster_role = 'gk') as gk_confirmed,
      count(*) filter (where r.status = 'confirmed' and r.roster_role = 'outfield') as outfield_confirmed,
      count(*) filter (where r.status = 'waitlisted' and r.roster_role = 'gk') as gk_waitlist,
      count(*) filter (where r.status = 'waitlisted' and r.roster_role = 'outfield') as outfield_waitlist
    from public.registrations r
    where r.match_id = m.id
  ) rc on true
  where m.id = p_match_id
    and m.status <> 'draft';
$$;

revoke all on function public.get_match_invite(uuid) from public;
grant execute on function public.get_match_invite(uuid) to anon, authenticated;

commit;
