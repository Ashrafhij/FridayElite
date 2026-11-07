-- ============================================================================
-- Friday Elite — Migration 0013
-- Keep team names in sync with team colors (e.g. yellow => "الفريق الأصفر").
--
-- - Updates public.set_match_team_colors so choosing a color also renames the
--   side ("الفريق الأصفر" / "الفريق الأزرق" / ...) in both match_teams and
--   group_settings (defaults for future generation).
-- - One-time data fix: renames existing match_teams / group_settings rows whose
--   color is a known preset but whose name still describes a different color.
--   Custom (non-color) team names are left untouched.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0012.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. set_match_team_colors: also sync the Arabic team name with the color
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

  update public.match_teams mt
     set color = lower(v_a),
         name_ar = case lower(v_a)
           when '#ffd60a' then 'الفريق الأصفر'
           when '#2f7bff' then 'الفريق الأزرق'
           when '#d2ff4d' then 'الفريق الأخضر'
           when '#ff4d4d' then 'الفريق الأحمر'
           when '#f5f3ea' then 'الفريق الأبيض'
           when '#ff9500' then 'الفريق البرتقالي'
           when '#a78bfa' then 'الفريق البنفسجي'
           else mt.name_ar
         end
   where mt.match_id = p_match_id and mt.side = 'A';

  update public.match_teams mt
     set color = lower(v_b),
         name_ar = case lower(v_b)
           when '#ffd60a' then 'الفريق الأصفر'
           when '#2f7bff' then 'الفريق الأزرق'
           when '#d2ff4d' then 'الفريق الأخضر'
           when '#ff4d4d' then 'الفريق الأحمر'
           when '#f5f3ea' then 'الفريق الأبيض'
           when '#ff9500' then 'الفريق البرتقالي'
           when '#a78bfa' then 'الفريق البنفسجي'
           else mt.name_ar
         end
   where mt.match_id = p_match_id and mt.side = 'B';

  -- Keep the chosen colors (and their names) as the default for future team
  -- generation so regenerating a match does not reset them.
  update public.group_settings gs
     set team_a_color = lower(v_a),
         team_b_color = lower(v_b),
         team_a_name = case lower(v_a)
           when '#ffd60a' then 'الفريق الأصفر'
           when '#2f7bff' then 'الفريق الأزرق'
           when '#d2ff4d' then 'الفريق الأخضر'
           when '#ff4d4d' then 'الفريق الأحمر'
           when '#f5f3ea' then 'الفريق الأبيض'
           when '#ff9500' then 'الفريق البرتقالي'
           when '#a78bfa' then 'الفريق البنفسجي'
           else gs.team_a_name
         end,
         team_b_name = case lower(v_b)
           when '#ffd60a' then 'الفريق الأصفر'
           when '#2f7bff' then 'الفريق الأزرق'
           when '#d2ff4d' then 'الفريق الأخضر'
           when '#ff4d4d' then 'الفريق الأحمر'
           when '#f5f3ea' then 'الفريق الأبيض'
           when '#ff9500' then 'الفريق البرتقالي'
           when '#a78bfa' then 'الفريق البنفسجي'
           else gs.team_b_name
         end
   where gs.id;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'match_team_colors_set', 'match', p_match_id::text, p_match_id,
          jsonb_build_object('team_a_color', lower(v_a), 'team_b_color', lower(v_b)));

  return;
end;
$$;

revoke all on function public.set_match_team_colors(uuid, text, text) from public;
grant execute on function public.set_match_team_colors(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. One-time fix for existing rows with stale names
-- ----------------------------------------------------------------------------
update public.match_teams
   set name_ar = case lower(color)
     when '#ffd60a' then 'الفريق الأصفر'
     when '#2f7bff' then 'الفريق الأزرق'
     when '#d2ff4d' then 'الفريق الأخضر'
     when '#ff4d4d' then 'الفريق الأحمر'
     when '#f5f3ea' then 'الفريق الأبيض'
     when '#ff9500' then 'الفريق البرتقالي'
     when '#a78bfa' then 'الفريق البنفسجي'
   end
 where lower(color) in ('#ffd60a', '#2f7bff', '#d2ff4d', '#ff4d4d', '#f5f3ea', '#ff9500', '#a78bfa')
   and name_ar in ('الفريق الأخضر', 'الفريق الأبيض', 'الفريق الأصفر', 'الفريق الأزرق',
                   'الفريق الأحمر', 'الفريق البرتقالي', 'الفريق البنفسجي');

update public.group_settings
   set team_a_name = case lower(team_a_color)
     when '#ffd60a' then 'الفريق الأصفر'
     when '#2f7bff' then 'الفريق الأزرق'
     when '#d2ff4d' then 'الفريق الأخضر'
     when '#ff4d4d' then 'الفريق الأحمر'
     when '#f5f3ea' then 'الفريق الأبيض'
     when '#ff9500' then 'الفريق البرتقالي'
     when '#a78bfa' then 'الفريق البنفسجي'
   end,
   team_b_name = case lower(team_b_color)
     when '#ffd60a' then 'الفريق الأصفر'
     when '#2f7bff' then 'الفريق الأزرق'
     when '#d2ff4d' then 'الفريق الأخضر'
     when '#ff4d4d' then 'الفريق الأحمر'
     when '#f5f3ea' then 'الفريق الأبيض'
     when '#ff9500' then 'الفريق البرتقالي'
     when '#a78bfa' then 'الفريق البنفسجي'
   end
 where lower(team_a_color) in ('#ffd60a', '#2f7bff', '#d2ff4d', '#ff4d4d', '#f5f3ea', '#ff9500', '#a78bfa')
   and team_a_name in ('الفريق الأخضر', 'الفريق الأبيض', 'الفريق الأصفر', 'الفريق الأزرق',
                       'الفريق الأحمر', 'الفريق البرتقالي', 'الفريق البنفسجي');

commit;
