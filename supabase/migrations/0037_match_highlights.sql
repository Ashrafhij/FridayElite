-- ============================================================================
-- Friday Elite — Migration 0037
-- Goal clips and match highlights.
--
-- Adds a public "match-highlights" Storage bucket with files grouped in a
-- folder per match (match-highlights/<match_id>/<file>). Only admins may
-- upload/delete files; every approved member can read the metadata, which is
-- what the match details and public result pages display.
--
-- Writes go through SECURITY DEFINER RPCs, matching the rest of the schema:
--   admin_add_match_highlight(uuid, text, text, text, text)
--   admin_delete_match_highlight(uuid) -> text (storage path to remove)
--
-- Run this ONCE in the Supabase SQL editor after 0001-0036.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Storage bucket
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'match-highlights',
  'match-highlights',
  true,
  52428800, -- 50 MB per file
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public bucket URLs need no SELECT policy for anonymous readers. The policy
-- below is for authenticated clients (e.g. storage listing / url refresh).
drop policy if exists match_highlights_select on storage.objects;
create policy match_highlights_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'match-highlights'
    and (public.is_admin() or public.is_approved())
  );

drop policy if exists match_highlights_insert_admin on storage.objects;
create policy match_highlights_insert_admin on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'match-highlights'
    and public.is_admin()
    and exists (
      select 1 from public.matches m
      where m.id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists match_highlights_update_admin on storage.objects;
create policy match_highlights_update_admin on storage.objects
  for update
  to authenticated
  using (bucket_id = 'match-highlights' and public.is_admin())
  with check (
    bucket_id = 'match-highlights'
    and public.is_admin()
    and exists (
      select 1 from public.matches m
      where m.id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists match_highlights_delete_admin on storage.objects;
create policy match_highlights_delete_admin on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'match-highlights' and public.is_admin());

-- ----------------------------------------------------------------------------
-- 2. Highlight metadata
-- ----------------------------------------------------------------------------
create table if not exists public.match_highlights (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.matches (id) on delete cascade,
  storage_path text not null unique,
  media_url    text not null,
  media_type   text not null check (media_type in ('image', 'video')),
  caption      text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists match_highlights_match_idx
  on public.match_highlights (match_id, created_at desc);

alter table public.match_highlights enable row level security;

drop policy if exists match_highlights_read on public.match_highlights;
create policy match_highlights_read
  on public.match_highlights for select to authenticated
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

revoke all on table public.match_highlights from anon, authenticated;
grant select on table public.match_highlights to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Admin RPC: register an uploaded file as a match highlight
-- ----------------------------------------------------------------------------
create or replace function public.admin_add_match_highlight(
  p_match_id      uuid,
  p_storage_path  text,
  p_media_url     text,
  p_media_type    text,
  p_caption       text default null
)
returns public.match_highlights
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match   public.matches%rowtype;
  v_path    text;
  v_caption text := nullif(left(btrim(p_caption), 240), '');
  v_row     public.match_highlights%rowtype;
begin
  perform public.assert_admin();

  if p_match_id is null or btrim(coalesce(p_storage_path, '')) = ''
     or btrim(coalesce(p_media_url, '')) = ''
     or btrim(coalesce(p_media_type, '')) = '' then
    raise exception 'HIGHLIGHT_REQUIRED';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match.status = 'cancelled' then
    raise exception 'HIGHLIGHTS_MATCH_CLOSED';
  end if;

  v_path := btrim(p_storage_path);

  -- Files live in <match_id>/<filename> only; no nested folders or traversal.
  if char_length(v_path) > 512
     or v_path !~ ('^' || p_match_id::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'INVALID_HIGHLIGHT_PATH';
  end if;

  if p_media_type not in ('image', 'video') then
    raise exception 'INVALID_HIGHLIGHT_TYPE';
  end if;

  if p_media_type = 'image' and v_path !~ '\.(jpg|jpeg|png|webp)$' then
    raise exception 'INVALID_HIGHLIGHT_TYPE';
  end if;
  if p_media_type = 'video' and v_path !~ '\.(mp4|webm|mov)$' then
    raise exception 'INVALID_HIGHLIGHT_TYPE';
  end if;

  if char_length(p_media_url) > 2048
     or p_media_url !~ '/storage/v1/object/public/match-highlights/'
     or strpos(p_media_url, v_path) = 0 then
    raise exception 'INVALID_HIGHLIGHT_URL';
  end if;

  insert into public.match_highlights (match_id, storage_path, media_url, media_type, caption, created_by)
  values (p_match_id, v_path, p_media_url, p_media_type, v_caption, (select auth.uid()))
  returning * into v_row;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values (
    (select auth.uid()), 'admin', 'match_highlight_added', 'match', p_match_id::text, p_match_id,
    jsonb_build_object(
      'highlight_id', v_row.id,
      'storage_path', v_path,
      'media_type', p_media_type,
      'caption', v_caption
    )
  );

  return v_row;
end;
$$;

revoke all on function public.admin_add_match_highlight(uuid, text, text, text, text) from public;
grant execute on function public.admin_add_match_highlight(uuid, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Admin RPC: remove a highlight (client also removes the Storage object)
-- ----------------------------------------------------------------------------
create or replace function public.admin_delete_match_highlight(p_highlight_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.match_highlights%rowtype;
begin
  perform public.assert_admin();

  select * into v_row
    from public.match_highlights
   where id = p_highlight_id
   for update;

  if not found then
    raise exception 'HIGHLIGHT_NOT_FOUND';
  end if;

  delete from public.match_highlights where id = p_highlight_id;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values (
    (select auth.uid()), 'admin', 'match_highlight_deleted', 'match', v_row.match_id::text, v_row.match_id,
    jsonb_build_object('highlight_id', p_highlight_id, 'storage_path', v_row.storage_path)
  );

  return v_row.storage_path;
end;
$$;

revoke all on function public.admin_delete_match_highlight(uuid) from public;
grant execute on function public.admin_delete_match_highlight(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Delete Storage files when a match is deleted
-- ----------------------------------------------------------------------------
-- Metadata rows cascade from matches; Storage objects do not, so clean up the
-- match's folder as well. Best-effort only: never block match deletion.
create or replace function public.cleanup_match_highlight_objects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from storage.objects
   where bucket_id = 'match-highlights'
     and name like old.id::text || '/%';
  return old;
exception when others then
  raise notice 'Could not remove highlight objects for match %: %', old.id, sqlerrm;
  return old;
end;
$$;

drop trigger if exists match_highlights_cleanup_objects on public.matches;
create trigger match_highlights_cleanup_objects
  after delete on public.matches
  for each row execute function public.cleanup_match_highlight_objects();

-- ----------------------------------------------------------------------------
-- 6. Realtime (best-effort, same pattern as 0006/0007)
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    if not exists (
      select 1 from pg_publication where pubname = 'supabase_realtime'
    ) then
      execute 'create publication supabase_realtime';
    end if;

    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'match_highlights'
    ) then
      execute 'alter publication supabase_realtime add table public.match_highlights';
    end if;
  exception when others then
    raise notice 'Realtime match-highlights setup skipped: %', sqlerrm;
  end;
end $$;

commit;
