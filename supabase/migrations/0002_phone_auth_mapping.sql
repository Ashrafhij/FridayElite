-- -------------------------------------------------
-- 0002_phone_auth_mapping.sql   (run once after dashboard changes)
-- -------------------------------------------------

-- 1️⃣ Change the default role for new profiles from 'player' to 'user'
alter table public.profiles alter column role set default 'user';

-- 2️⃣ Create a protected mapping between phone numbers and internal emails
create table if not exists public.phone_email_map (
    id uuid primary key references auth.users(id) on delete cascade,
    phone text not null unique,
    internal_email text not null unique
);

-- 3️⃣ Enable Row‑Level Security and lock the table down
alter table public.phone_email_map enable row level security;

-- 4️⃣ Policy: only the service_role may read / insert (no anon / authenticated access)
create policy "service_role_only" on public.phone_email_map
    using (current_setting('role') = 'service_role')
    with check (current_setting('role') = 'service_role');

-- 5️⃣ (Optional) Seed the map for any existing profiles – run only once
-- insert into public.phone_email_map (id, phone, internal_email)
--   select id, phone, 'int-' || encode(gen_random_bytes(8), 'hex') || '@fridayelite.internal'
--   from public.profiles
--   where role = 'user';