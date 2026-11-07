-- ============================================================================
-- Friday Elite — Migration 0014
-- Expose the one-time (external) player flag in the player directory so the
-- pitch can highlight guest players for admins.
--
-- Adds is_external to public.player_directory (profiles.is_external, created
-- in 0010). Existing data is unaffected.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0013.
-- ============================================================================

begin;

create or replace view public.player_directory as
select p.id,
       p.full_name,
       p.avatar_url,
       p.jersey_number,
       p.preferred_foot,
       p.is_external
from public.profiles p
where p.status = 'approved'
  and public.is_approved();

revoke all on public.player_directory from anon, authenticated;
grant select on public.player_directory to authenticated;

commit;
