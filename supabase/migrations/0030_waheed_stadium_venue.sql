-- ============================================================================
-- Friday Elite — Migration 0030
-- The group only ever plays at ملعب وحيد. Some existing matches still carry
-- the venue "ملعب الحي"; rename them to the stadium's standard name.
--
-- Run this ONCE in the Supabase SQL editor after 0001-0029.
-- ============================================================================

begin;

update public.matches
set venue = 'ملعب وحيد — العشب الصناعي'
where btrim(venue) like 'ملعب الحي%';

commit;
