-- ============================================================================
-- Friday Elite — Migration 0029
-- Fix: a cancelled registration must not look like "phone not registered".
--
-- lookup_player_for_registration() returned ZERO rows whenever the player had
-- no ACTIVE registration for the match — including when the player existed
-- but had previously cancelled. The join page treated zero rows as "unknown
-- phone", sending a returning player to the sign-up screen instead of the
-- confirm screen (they could never re-register via the link).
--
-- Now the function always returns one row when the player's account exists:
-- with the active registration's details when there is one, and with NULL
-- registration fields when there is none (cancelled, or never registered).
-- Only a phone with no account at all still returns zero rows.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0028.
-- ============================================================================

begin;

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

  -- No account with this number at all -> zero rows (unknown phone).
  if not found then
    return;
  end if;

  -- Account exists: always return one row. A cancelled/never-made
  -- registration yields NULL registration fields, which sends the player
  -- to the confirm screen so they can register (again).
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
    from (select 1) base
    left join (
      select r.status, r.queue_position, r.roster_role
      from public.registrations r
      where r.match_id = p_match_id
        and r.player_id = v_player.id
        and r.status <> 'cancelled'
      order by r.registered_at desc
      limit 1
    ) rr on true;
end;
$$;

revoke all on function public.lookup_player_for_registration(uuid, text) from public;
grant execute on function public.lookup_player_for_registration(uuid, text) to anon, authenticated;

commit;
