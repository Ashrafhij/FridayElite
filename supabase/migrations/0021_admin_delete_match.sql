-- ============================================================================
-- Friday Elite — Migration 0021
-- Admin can delete a match entirely.
--
-- Adds public.admin_delete_match(p_match_id): removes the match and all its
-- dependent data (registrations, teams, assignments, results, scorers,
-- ratings). One-time external player profiles for the match are removed via
-- their cascading FK. Registrations must be deleted explicitly because their
-- FK to matches is ON DELETE RESTRICT.
--
-- Note: weekly Friday fixtures are auto-created; deleting one may let the
-- scheduler recreate it.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0020.
-- ============================================================================

begin;

create or replace function public.admin_delete_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
begin
  perform public.assert_admin();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values ((select auth.uid()), 'admin', 'match_deleted', 'match', p_match_id::text, p_match_id,
          jsonb_build_object(
            'local_date', v_match.local_date,
            'kickoff_at', v_match.kickoff_at,
            'venue', v_match.venue,
            'status', v_match.status
          ));

  -- Registrations reference matches with ON DELETE RESTRICT: remove them
  -- first. Everything else (teams, assignments, results, scorers, ratings,
  -- external guest profiles) cascades from the match row.
  delete from public.registrations where match_id = p_match_id;
  delete from public.matches where id = p_match_id;

  return;
end;
$$;

revoke all on function public.admin_delete_match(uuid) from public;
grant execute on function public.admin_delete_match(uuid) to authenticated;

commit;
