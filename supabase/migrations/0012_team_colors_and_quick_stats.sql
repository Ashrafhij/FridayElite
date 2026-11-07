-- ============================================================================
-- Friday Elite — Migration 0012
-- Per-match team colors and quick per-player goals/assists entry.
--
-- - Adds public.set_match_team_colors(p_match_id, p_team_a_color, p_team_b_color)
--   so an admin can choose which side wears yellow, blue, etc. The choice is
--   applied to the current match's match_teams rows and becomes the default
--   for future team generation (group_settings), so regenerating a match keeps
--   the chosen colors.
-- - Adds public.set_player_match_stats(p_match_id, p_player_id, p_goals, p_assists)
--   so an admin can click a player on the pitch and set that player's goals and
--   assists for the match. The final score is recomputed automatically from
--   all scorers, the match is marked completed (opening ratings), and saving
--   0 goals / 0 assists removes the player's stats row.
-- - Relaxes match_scorers.goals to allow 0 so assists-only players can be
--   recorded, and updates set_match_result to accept assists-only rows.
--
-- Existing profiles/registrations/results are unaffected. Run this ONCE in the
-- Supabase SQL editor after 0001-0011.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Allow assists-only scorer rows (goals = 0)
-- ----------------------------------------------------------------------------
alter table public.match_scorers drop constraint if exists match_scorers_goals_check;
alter table public.match_scorers
  add constraint match_scorers_goals_check check (goals between 0 and 30);

-- ----------------------------------------------------------------------------
-- 2. set_match_result: accept assists-only rows (goals = 0, assists > 0)
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
    if v_scorer.player_id is null or v_scorer.goals is null
       or v_scorer.goals < 0 or v_scorer.goals > 30
       or coalesce(v_scorer.assists, 0) < 0 or coalesce(v_scorer.assists, 0) > 30
       or (v_scorer.goals = 0 and coalesce(v_scorer.assists, 0) = 0) then
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
-- 3. Admin-only team colors for a match
-- ----------------------------------------------------------------------------
create or replace function public.set_match_team_colors(
  p_match_id      uuid,
  p_team_a_color  text,
  p_team_b_color  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match  public.matches%rowtype;
  v_a      text := nullif(btrim(p_team_a_color), '');
  v_b      text := nullif(btrim(p_team_b_color), '');
begin
  perform public.assert_admin();

  if v_a is null or v_b is null
     or v_a !~ '^#[0-9a-fA-F]{6}$'
     or v_b !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'INVALID_TEAM_COLOR';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status = 'cancelled' then
    raise exception 'MATCH_CLOSED';
  end if;

  if not exists (select 1 from public.match_teams where match_id = p_match_id) then
    raise exception 'TEAMS_NOT_GENERATED';
  end if;

  update public.match_teams
     set color = lower(v_a)
   where match_id = p_match_id and side = 'A';

  update public.match_teams
     set color = lower(v_b)
   where match_id = p_match_id and side = 'B';

  -- Keep the chosen colors as the default for future team generation so
  -- regenerating this (or a future) match does not reset them.
  update public.group_settings
     set team_a_color = lower(v_a),
         team_b_color = lower(v_b)
   where id;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'match_team_colors_set', 'match', p_match_id::text, p_match_id,
          jsonb_build_object('team_a_color', lower(v_a), 'team_b_color', lower(v_b)));

  return;
end;
$$;

revoke all on function public.set_match_team_colors(uuid, text, text) from public;
grant execute on function public.set_match_team_colors(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Quick per-player goals/assists entry (admin clicks a player on the pitch)
-- ----------------------------------------------------------------------------
create or replace function public.set_player_match_stats(
  p_match_id   uuid,
  p_player_id  uuid,
  p_goals      integer,
  p_assists    integer
)
returns public.match_scorers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match   public.matches%rowtype;
  v_team_id uuid;
  v_scorer  public.match_scorers%rowtype;
  v_score_a integer;
  v_score_b integer;
begin
  perform public.assert_admin();

  if p_goals is null or p_assists is null
     or p_goals < 0 or p_goals > 30
     or p_assists < 0 or p_assists > 30 then
    raise exception 'INVALID_MATCH_STATS';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status = 'cancelled' then
    raise exception 'MATCH_CLOSED';
  end if;

  select ta.team_id into v_team_id
    from public.team_assignments ta
   where ta.match_id = p_match_id
     and ta.player_id = p_player_id;

  if not found then
    raise exception 'PLAYER_NOT_ASSIGNED';
  end if;

  if p_goals = 0 and p_assists = 0 then
    -- Saving zeros removes the player's stats row.
    delete from public.match_scorers
     where match_id = p_match_id and player_id = p_player_id;
    v_scorer := null;
  else
    insert into public.match_scorers (match_id, player_id, team_id, goals, assists)
    values (p_match_id, p_player_id, v_team_id, p_goals, p_assists)
    on conflict (match_id, player_id) do update
      set team_id = excluded.team_id,
          goals = excluded.goals,
          assists = excluded.assists,
          updated_at = now()
    returning * into v_scorer;
  end if;

  -- Recompute the final score from all recorded scorers so the displayed
  -- result always matches the per-player stats. Notes are preserved.
  select
    coalesce(sum(ms.goals) filter (where mt.side = 'A'), 0)::integer,
    coalesce(sum(ms.goals) filter (where mt.side = 'B'), 0)::integer
    into v_score_a, v_score_b
    from public.match_scorers ms
    join public.match_teams mt on mt.id = ms.team_id
   where ms.match_id = p_match_id;

  if exists (select 1 from public.match_results where match_id = p_match_id) then
    update public.match_results
       set team_a_score = v_score_a,
           team_b_score = v_score_b,
           updated_at = now()
     where match_id = p_match_id;
  elsif v_scorer is not null then
    insert into public.match_results (match_id, team_a_score, team_b_score, created_by)
    values (p_match_id, v_score_a, v_score_b, (select auth.uid()));
  end if;

  -- Recording stats closes the match and opens player ratings.
  update public.matches
     set status = 'completed'
   where id = p_match_id
     and status <> 'completed';

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'player_match_stats_set', 'match', p_match_id::text, p_match_id,
          jsonb_build_object('player_id', p_player_id, 'goals', p_goals, 'assists', p_assists));

  return v_scorer;
end;
$$;

revoke all on function public.set_player_match_stats(uuid, uuid, integer, integer) from public;
grant execute on function public.set_player_match_stats(uuid, uuid, integer, integer) to authenticated;

commit;
