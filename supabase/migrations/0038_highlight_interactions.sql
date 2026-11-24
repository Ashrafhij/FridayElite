-- ============================================================================
-- Friday Elite — Migration 0038
-- Likes and comments on match highlights.
--
-- Approved members (including admins) can like and comment on goal clips /
-- highlights. Reads are available to approved members and admins, matching
-- the match_highlights table from 0037. All writes go through RPCs so the
-- same validation and audit rules apply everywhere.
--
--   toggle_match_highlight_like(uuid) -> boolean
--   add_match_highlight_comment(uuid, text) -> match_highlight_comments
--   delete_match_highlight_comment(uuid)
--
-- Run this ONCE in the Supabase SQL editor after 0037.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Likes (one per member per highlight)
-- ----------------------------------------------------------------------------
create table if not exists public.match_highlight_likes (
  highlight_id uuid not null references public.match_highlights (id) on delete cascade,
  match_id     uuid not null references public.matches (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (highlight_id, user_id)
);

create index if not exists match_highlight_likes_match_idx
  on public.match_highlight_likes (match_id);

-- ----------------------------------------------------------------------------
-- 2. Comments
-- ----------------------------------------------------------------------------
create table if not exists public.match_highlight_comments (
  id           uuid primary key default gen_random_uuid(),
  highlight_id uuid not null references public.match_highlights (id) on delete cascade,
  match_id     uuid not null references public.matches (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  body         text not null check (char_length(btrim(body)) between 1 and 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists match_highlight_comments_highlight_idx
  on public.match_highlight_comments (highlight_id, created_at);
create index if not exists match_highlight_comments_match_idx
  on public.match_highlight_comments (match_id);

drop trigger if exists match_highlight_comments_set_updated_at on public.match_highlight_comments;
create trigger match_highlight_comments_set_updated_at
  before update on public.match_highlight_comments
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS and grants (reads only — writes through RPCs)
-- ----------------------------------------------------------------------------
alter table public.match_highlight_likes enable row level security;
alter table public.match_highlight_comments enable row level security;

drop policy if exists match_highlight_likes_read on public.match_highlight_likes;
create policy match_highlight_likes_read
  on public.match_highlight_likes for select to authenticated
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

drop policy if exists match_highlight_comments_read on public.match_highlight_comments;
create policy match_highlight_comments_read
  on public.match_highlight_comments for select to authenticated
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

revoke all on table public.match_highlight_likes, public.match_highlight_comments from anon, authenticated;
grant select on table public.match_highlight_likes, public.match_highlight_comments to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Like / unlike (returns the new liked state)
-- ----------------------------------------------------------------------------
create or replace function public.toggle_match_highlight_like(p_highlight_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_match_id uuid;
  v_liked    boolean;
begin
  if not public.is_approved() then
    raise exception 'ACCOUNT_NOT_APPROVED';
  end if;

  select h.match_id into v_match_id
    from public.match_highlights h
   where h.id = p_highlight_id;

  if not found then
    raise exception 'HIGHLIGHT_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.match_highlight_likes
     where highlight_id = p_highlight_id and user_id = v_uid
  ) then
    delete from public.match_highlight_likes
     where highlight_id = p_highlight_id and user_id = v_uid;
    v_liked := false;
  else
    insert into public.match_highlight_likes (highlight_id, match_id, user_id)
    values (p_highlight_id, v_match_id, v_uid);
    v_liked := true;
  end if;

  return v_liked;
end;
$$;

revoke all on function public.toggle_match_highlight_like(uuid) from public;
grant execute on function public.toggle_match_highlight_like(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Add a comment
-- ----------------------------------------------------------------------------
create or replace function public.add_match_highlight_comment(
  p_highlight_id uuid,
  p_body         text
)
returns public.match_highlight_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_match_id uuid;
  v_body     text := left(btrim(p_body), 500);
  v_row      public.match_highlight_comments%rowtype;
begin
  if not public.is_approved() then
    raise exception 'ACCOUNT_NOT_APPROVED';
  end if;

  if v_body is null or char_length(v_body) = 0 then
    raise exception 'INVALID_HIGHLIGHT_COMMENT';
  end if;

  select h.match_id into v_match_id
    from public.match_highlights h
   where h.id = p_highlight_id;

  if not found then
    raise exception 'HIGHLIGHT_NOT_FOUND';
  end if;

  insert into public.match_highlight_comments (highlight_id, match_id, user_id, body)
  values (p_highlight_id, v_match_id, v_uid, v_body)
  returning * into v_row;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values (
    v_uid,
    case when public.is_admin() then 'admin' else 'player' end,
    'highlight_comment_added',
    'match',
    v_match_id::text,
    v_match_id,
    jsonb_build_object('highlight_id', p_highlight_id, 'comment_id', v_row.id)
  );

  return v_row;
end;
$$;

revoke all on function public.add_match_highlight_comment(uuid, text) from public;
grant execute on function public.add_match_highlight_comment(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Delete a comment (author or admin only)
-- ----------------------------------------------------------------------------
create or replace function public.delete_match_highlight_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.match_highlight_comments%rowtype;
begin
  if not public.is_approved() then
    raise exception 'ACCOUNT_NOT_APPROVED';
  end if;

  select * into v_row
    from public.match_highlight_comments
   where id = p_comment_id
   for update;

  if not found then
    raise exception 'HIGHLIGHT_COMMENT_NOT_FOUND';
  end if;

  if v_row.user_id <> v_uid and not public.is_admin() then
    raise exception 'PERMISSION';
  end if;

  delete from public.match_highlight_comments where id = p_comment_id;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, match_id, payload)
  values (
    v_uid,
    case when public.is_admin() then 'admin' else 'player' end,
    'highlight_comment_deleted',
    'match',
    v_row.match_id::text,
    v_row.match_id,
    jsonb_build_object('highlight_id', v_row.highlight_id, 'comment_id', p_comment_id)
  );
end;
$$;

revoke all on function public.delete_match_highlight_comment(uuid) from public;
grant execute on function public.delete_match_highlight_comment(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Realtime (best-effort)
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
         and tablename = 'match_highlight_comments'
    ) then
      execute 'alter publication supabase_realtime add table public.match_highlight_comments';
    end if;

    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'match_highlight_likes'
    ) then
      execute 'alter publication supabase_realtime add table public.match_highlight_likes';
    end if;
  exception when others then
    raise notice 'Realtime highlight interactions setup skipped: %', sqlerrm;
  end;
end $$;

commit;
