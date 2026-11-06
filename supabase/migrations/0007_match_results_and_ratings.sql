-- ============================================================================
-- Friday Elite — Migration 0007
-- Match results, scorers, and post-match player ratings.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0006.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Durable final result and scorers
-- ----------------------------------------------------------------------------
create table if not exists public.match_results (
  match_id       uuid primary key references public.matches (id) on delete cascade,
  team_a_score   smallint not null check (team_a_score between 0 and 99),
  team_b_score   smallint not null check (team_b_score between 0 and 99),
  notes          text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.match_scorers (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches (id) on delete cascade,
  player_id   uuid not null references public.profiles (id) on delete restrict,
  team_id     uuid not null,
  goals       smallint not null check (goals between 1 and 30),
  assists     smallint not null default 0 check (assists between 0 and 30),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint match_scorers_team_match_fk
    foreign key (team_id, match_id)
    references public.match_teams (id, match_id) on delete cascade,
  constraint match_scorers_one_player_uq unique (match_id, player_id)
);

create index if not exists match_scorers_match_idx on public.match_scorers (match_id, team_id);
create index if not exists match_scorers_player_idx on public.match_scorers (player_id);

drop trigger if exists match_results_set_updated_at on public.match_results;
create trigger match_results_set_updated_at
  before update on public.match_results
  for each row execute function public.set_updated_at();

drop trigger if exists match_scorers_set_updated_at on public.match_scorers;
create trigger match_scorers_set_updated_at
  before update on public.match_scorers
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Player ratings (1-5; anonymous averages are exposed via summary table)
-- ----------------------------------------------------------------------------
create table if not exists public.player_ratings (
  id                uuid primary key default gen_random_uuid(),
  match_id          uuid not null references public.matches (id) on delete cascade,
  rater_id          uuid not null references public.profiles (id) on delete cascade,
  rated_player_id   uuid not null references public.profiles (id) on delete restrict,
  rating            smallint not null check (rating between 1 and 10),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint player_ratings_no_self check (rater_id <> rated_player_id),
  constraint player_ratings_unique unique (match_id, rater_id, rated_player_id)
);

create index if not exists player_ratings_match_idx on public.player_ratings (match_id, rated_player_id);
create index if not exists player_ratings_rater_idx on public.player_ratings (match_id, rater_id);

drop trigger if exists player_ratings_set_updated_at on public.player_ratings;
create trigger player_ratings_set_updated_at
  before update on public.player_ratings
  for each row execute function public.set_updated_at();

-- Only the rater (and admins) can read individual rating rows.
alter table public.player_ratings enable row level security;

drop policy if exists player_ratings_select_own on public.player_ratings;
create policy player_ratings_select_own
  on public.player_ratings for select to authenticated
  using (rater_id = (select auth.uid()) or public.is_admin());

revoke all on table public.player_ratings from anon, authenticated;
grant select on table public.player_ratings to authenticated;

-- Maintained aggregates: all approved players can read averages, while raw
-- individual ratings stay private to the rater/admin (and Realtime-safe).
create table if not exists public.match_player_rating_stats (
  match_id       uuid not null references public.matches (id) on delete cascade,
  player_id      uuid not null references public.profiles (id) on delete cascade,
  average_rating numeric(4, 2) not null check (average_rating between 1 and 10),
  rating_count   integer not null check (rating_count > 0),
  updated_at     timestamptz not null default now(),
  primary key (match_id, player_id)
);

alter table public.match_player_rating_stats enable row level security;

drop policy if exists match_player_rating_stats_read on public.match_player_rating_stats;
create policy match_player_rating_stats_read
  on public.match_player_rating_stats for select to authenticated
  using (public.is_admin() or public.is_approved());

revoke all on table public.match_player_rating_stats from anon, authenticated;
grant select on table public.match_player_rating_stats to authenticated;

-- Keep the summary current if raw ratings are ever changed outside rate_player().
create or replace function public.refresh_match_player_rating_stat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_id uuid;
  v_player_id uuid;
begin
  if tg_op = 'DELETE' then
    v_match_id := old.match_id;
    v_player_id := old.rated_player_id;
  else
    v_match_id := new.match_id;
    v_player_id := new.rated_player_id;
  end if;

  if exists (
    select 1
      from public.player_ratings
     where match_id = v_match_id
       and rated_player_id = v_player_id
  ) then
    insert into public.match_player_rating_stats (match_id, player_id, average_rating, rating_count)
    select
      v_match_id,
      v_player_id,
      round(avg(rating)::numeric, 2),
      count(*)::integer
      from public.player_ratings
     where match_id = v_match_id
       and rated_player_id = v_player_id
    on conflict (match_id, player_id) do update
      set average_rating = excluded.average_rating,
          rating_count = excluded.rating_count,
          updated_at = now();
  end if;

  delete from public.match_player_rating_stats
   where match_id = v_match_id
     and player_id = v_player_id
     and not exists (
       select 1 from public.player_ratings
        where match_id = v_match_id
          and rated_player_id = v_player_id
     );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists player_ratings_refresh_stat on public.player_ratings;
create trigger player_ratings_refresh_stat
  after insert or update or delete on public.player_ratings
  for each row execute function public.refresh_match_player_rating_stat();

-- ----------------------------------------------------------------------------
-- 3. RLS/grants for result data (writes only through RPCs)
-- ----------------------------------------------------------------------------
alter table public.match_results enable row level security;
alter table public.match_scorers enable row level security;

drop policy if exists match_results_read on public.match_results;
create policy match_results_read
  on public.match_results for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_approved()
      and exists (
        select 1 from public.matches m
         where m.id = match_id and m.status <> 'draft'
      )
    )
  );

drop policy if exists match_scorers_read on public.match_scorers;
create policy match_scorers_read
  on public.match_scorers for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_approved()
      and exists (
        select 1 from public.matches m
         where m.id = match_id and m.status <> 'draft'
      )
    )
  );

revoke all on table public.match_results, public.match_scorers from anon, authenticated;
grant select on table public.match_results, public.match_scorers to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Admin-only final result entry
-- ----------------------------------------------------------------------------
create or replace function public.set_match_result(
  p_match_id       uuid,
  p_team_a_score   integer,
  p_team_b_score   integer,
  p_scorers        jsonb default '[]'::jsonb,
  p_notes          text default null
)
returns public.match_results
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match       public.matches%rowtype;
  v_result      public.match_results%rowtype;
  v_scorer      record;
  v_team_id     uuid;
  v_score_a     integer;
  v_score_b     integer;
begin
  perform public.assert_admin();

  select * into v_match
    from public.matches
   where id = p_match_id
   for update;

  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status = 'cancelled' then
    raise exception 'MATCH_CLOSED';
  end if;

  if p_team_a_score is null or p_team_b_score is null
     or p_team_a_score < 0 or p_team_b_score < 0
     or p_team_a_score > 99 or p_team_b_score > 99 then
    raise exception 'INVALID_SCORE';
  end if;

  if p_scorers is null then
    p_scorers := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_scorers) <> 'array' then
    raise exception 'INVALID_SCORERS';
  end if;

  delete from public.match_scorers where match_id = p_match_id;

  for v_scorer in
    select * from jsonb_to_recordset(p_scorers) as x(
      player_id uuid,
      goals integer,
      assists integer
    )
  loop
    if v_scorer.player_id is null or v_scorer.goals is null or v_scorer.goals < 1 then
      raise exception 'INVALID_SCORER_PLAYER';
    end if;
    if v_scorer.assists is not null and v_scorer.assists < 0 then
      raise exception 'INVALID_SCORER_PLAYER';
    end if;

    select ta.team_id into v_team_id
      from public.team_assignments ta
     where ta.match_id = p_match_id
       and ta.player_id = v_scorer.player_id;

    if not found then
      raise exception 'INVALID_SCORER_PLAYER';
    end if;

    insert into public.match_scorers (match_id, player_id, team_id, goals, assists)
    values (
      p_match_id,
      v_scorer.player_id,
      v_team_id,
      v_scorer.goals,
      coalesce(v_scorer.assists, 0)
    );
  end loop;

  select
    coalesce(sum(ms.goals) filter (where mt.side = 'A'), 0)::integer,
    coalesce(sum(ms.goals) filter (where mt.side = 'B'), 0)::integer
    into v_score_a, v_score_b
    from public.match_scorers ms
    join public.match_teams mt on mt.id = ms.team_id
   where ms.match_id = p_match_id;

  if v_score_a <> p_team_a_score or v_score_b <> p_team_b_score then
    raise exception 'RESULT_SCORE_MISMATCH';
  end if;

  insert into public.match_results (
    match_id, team_a_score, team_b_score, notes, created_by
  )
  values (
    p_match_id,
    p_team_a_score,
    p_team_b_score,
    nullif(btrim(p_notes), ''),
    (select auth.uid())
  )
  on conflict (match_id) do update
    set team_a_score = excluded.team_a_score,
        team_b_score = excluded.team_b_score,
        notes = excluded.notes,
        created_by = excluded.created_by,
        updated_at = now()
  returning * into v_result;

  -- Entering the final result closes the match for registration purposes.
  update public.matches
     set status = 'completed'
   where id = p_match_id
     and status <> 'completed';

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'match_result_set', 'match', p_match_id::text, p_match_id,
          jsonb_build_object(
            'team_a_score', p_team_a_score,
            'team_b_score', p_team_b_score,
            'scorers', p_scorers,
            'notes', p_notes
          ));

  return v_result;
end;
$$;

revoke all on function public.set_match_result(uuid, integer, integer, jsonb, text) from public;
grant execute on function public.set_match_result(uuid, integer, integer, jsonb, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Ratings
-- ----------------------------------------------------------------------------
create or replace function public.rate_player(
  p_match_id         uuid,
  p_rated_player_id  uuid,
  p_rating           integer
)
returns public.player_ratings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_match public.matches%rowtype;
  v_row   public.player_ratings%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if p_rated_player_id = v_uid then
    raise exception 'CANNOT_RATE_SELF';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 10 then
    raise exception 'INVALID_RATING';
  end if;
  if not public.is_approved() then
    raise exception 'ACCOUNT_NOT_APPROVED';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status <> 'completed' then
    raise exception 'MATCH_NOT_COMPLETED';
  end if;

  if not exists (
    select 1 from public.registrations r
     where r.match_id = p_match_id
       and r.player_id = v_uid
       and r.status = 'confirmed'
  ) then
    raise exception 'NOT_MATCH_PARTICIPANT';
  end if;

  if not exists (
    select 1 from public.registrations r
     where r.match_id = p_match_id
       and r.player_id = p_rated_player_id
       and r.status = 'confirmed'
  ) then
    raise exception 'NOT_MATCH_PARTICIPANT';
  end if;

  insert into public.player_ratings (match_id, rater_id, rated_player_id, rating)
  values (p_match_id, v_uid, p_rated_player_id, p_rating)
  on conflict (match_id, rater_id, rated_player_id) do update
    set rating = excluded.rating,
        updated_at = now()
  returning * into v_row;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values (v_uid, 'player', 'player_rated', 'player_rating', v_row.id::text, p_match_id,
          jsonb_build_object('rated_player_id', p_rated_player_id, 'rating', p_rating));

  return v_row;
end;
$$;

revoke all on function public.rate_player(uuid, uuid, integer) from public;
grant execute on function public.rate_player(uuid, uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Realtime for new result/rating data (best-effort)
-- ----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  begin
    if not exists (
      select 1 from pg_publication where pubname = 'supabase_realtime'
    ) then
      execute 'create publication supabase_realtime';
    end if;

    foreach v_table in array array[
      'public.match_results',
      'public.match_scorers',
      'public.match_player_rating_stats'
    ] loop
      if not exists (
        select 1
          from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = split_part(v_table, '.', 1)
           and tablename = split_part(v_table, '.', 2)
      ) then
        execute format('alter publication supabase_realtime add table %s', v_table);
      end if;
    end loop;
  exception when others then
    raise notice 'Realtime result/rating setup skipped: %', sqlerrm;
  end;
end $$;

commit;
