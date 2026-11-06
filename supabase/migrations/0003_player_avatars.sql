-- ============================================================================
-- Friday Elite — Migration 0003
-- Player profile photos.
--
-- Creates a public "avatars" bucket and locks writes to each user's own
-- folder: avatars/<auth.uid()>/avatar.jpg
--
-- Also replaces update_my_profile() so avatar_url can only point at the
-- caller's own file in this project's Storage. This stops a user from setting
-- an arbitrary external image URL on their profile.
--
-- Run this ONCE in the Supabase SQL editor after 0002.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Storage bucket
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 2. Storage policies
-- ----------------------------------------------------------------------------
-- Reads use the public object URL, so no SELECT policy is needed (and no
-- listing access is granted). Uploads and deletes are limited to the folder
-- named after the authenticated user.
drop policy if exists avatars_insert_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;

create policy avatars_insert_own on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_update_own on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_delete_own on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ----------------------------------------------------------------------------
-- 3. Validate avatar_url in update_my_profile()
-- ----------------------------------------------------------------------------
create or replace function public.update_my_profile(
  p_full_name      text,
  p_avatar_url     text,
  p_preferred_foot text,
  p_jersey_number  smallint
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_row    public.profiles%rowtype;
  v_avatar text := nullif(btrim(p_avatar_url), '');
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if not public.can_manage_own_profile() then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  if p_full_name is null or char_length(btrim(p_full_name)) < 2 then
    raise exception 'INVALID_NAME';
  end if;

  if p_preferred_foot is not null and p_preferred_foot not in ('right', 'left', 'both') then
    raise exception 'INVALID_PREFERRED_FOOT';
  end if;

  if p_jersey_number is not null and (p_jersey_number < 1 or p_jersey_number > 99) then
    raise exception 'INVALID_JERSEY_NUMBER';
  end if;

  if v_avatar is not null then
    if char_length(v_avatar) > 2048 then
      raise exception 'INVALID_AVATAR';
    end if;

    if v_avatar !~ (
      '^https://[a-z0-9-]+\.supabase\.(co|in)/storage/v1/object/public/avatars/'
      || v_uid::text
      || '/avatar\.(jpg|jpeg|png|webp)(\?v=[0-9]+)?$'
    ) then
      raise exception 'INVALID_AVATAR';
    end if;
  end if;

  update public.profiles
  set full_name      = left(btrim(p_full_name), 80),
      avatar_url     = v_avatar,
      preferred_foot = p_preferred_foot,
      jersey_number  = p_jersey_number
  where id = v_uid
  returning * into v_row;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, payload)
  values (v_uid, v_row.role, 'profile_updated', 'profile', v_uid::text,
          jsonb_build_object('jersey_number', p_jersey_number,
                             'preferred_foot', p_preferred_foot,
                             'has_avatar', v_avatar is not null));

  return v_row;
end;
$$;

revoke all on function public.update_my_profile(text, text, text, smallint) from public;
grant execute on function public.update_my_profile(text, text, text, smallint) to authenticated;

commit;
