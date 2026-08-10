create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null default '새 여행',
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.trip_documents (
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_date date not null,
  list_title text not null default '여행 일정',
  schedule jsonb not null default '[]'::jsonb,
  version bigint not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (trip_id, trip_date)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  place_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists comments_trip_place_idx
  on public.comments (trip_id, place_id, created_at);
create index if not exists invites_trip_idx on public.invites (trip_id);

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_documents enable row level security;
alter table public.comments enable row level security;
alter table public.invites enable row level security;

create or replace function public.is_trip_member(target_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = target_trip_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_trip_member(uuid) from public, anon;
grant execute on function public.is_trip_member(uuid) to authenticated;

drop policy if exists "Users can read their profile" on public.profiles;
drop policy if exists "Users can update their profile" on public.profiles;
drop policy if exists "Users can create their profile" on public.profiles;
drop policy if exists "Trip members can read profiles" on public.profiles;

create policy "Users can create their profile" on public.profiles
for insert with check (id = auth.uid());
create policy "Users can update their profile" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());
create policy "Trip members can read profiles" on public.profiles
for select using (
  id = auth.uid() or exists (
    select 1
    from public.trip_members mine
    join public.trip_members theirs on theirs.trip_id = mine.trip_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);

drop policy if exists "Members can read trips" on public.trips;
create policy "Members can read trips" on public.trips
for select using (public.is_trip_member(id));

drop policy if exists "Members can read trip memberships" on public.trip_members;
create policy "Members can read trip memberships" on public.trip_members
for select using (public.is_trip_member(trip_id));

drop policy if exists "Members can read trip documents" on public.trip_documents;
drop policy if exists "Members can create trip documents" on public.trip_documents;
drop policy if exists "Members can update trip documents" on public.trip_documents;
drop policy if exists "Members can delete trip documents" on public.trip_documents;
create policy "Members can read trip documents" on public.trip_documents
for select using (public.is_trip_member(trip_id));
create policy "Members can create trip documents" on public.trip_documents
for insert with check (public.is_trip_member(trip_id) and updated_by = auth.uid());
create policy "Members can update trip documents" on public.trip_documents
for update using (public.is_trip_member(trip_id))
with check (public.is_trip_member(trip_id) and updated_by = auth.uid());
create policy "Members can delete trip documents" on public.trip_documents
for delete using (public.is_trip_member(trip_id));

drop policy if exists "Members can read comments" on public.comments;
drop policy if exists "Members can create comments" on public.comments;
drop policy if exists "Authors can update comments" on public.comments;
drop policy if exists "Authors can delete comments" on public.comments;
create policy "Members can read comments" on public.comments
for select using (public.is_trip_member(trip_id));
create policy "Members can create comments" on public.comments
for insert with check (public.is_trip_member(trip_id) and user_id = auth.uid());
create policy "Authors can update comments" on public.comments
for update using (user_id = auth.uid())
with check (user_id = auth.uid() and public.is_trip_member(trip_id));
create policy "Authors can delete comments" on public.comments
for delete using (user_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'nickname',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      '여행자'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do update set
    nickname = excluded.nickname,
    avatar_url = excluded.avatar_url,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of raw_user_meta_data on auth.users
for each row execute procedure public.handle_new_user();

insert into public.profiles (id, nickname, avatar_url)
select
  id,
  coalesce(raw_user_meta_data ->> 'nickname', raw_user_meta_data ->> 'name', raw_user_meta_data ->> 'full_name', '여행자'),
  coalesce(raw_user_meta_data ->> 'avatar_url', raw_user_meta_data ->> 'picture')
from auth.users
on conflict (id) do nothing;

create or replace function public.create_trip(p_name text default '새 여행')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_trip_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.trips (name, owner_id)
  values (coalesce(nullif(trim(p_name), ''), '새 여행'), auth.uid())
  returning id into new_trip_id;
  insert into public.trip_members (trip_id, user_id, role)
  values (new_trip_id, auth.uid(), 'owner');
  return new_trip_id;
end;
$$;

create or replace function public.create_invite(p_trip_id uuid, p_expires_in_hours integer default 168)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_token text;
begin
  if not exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = auth.uid() and role = 'owner'
  ) then raise exception 'Only the trip owner can create invites'; end if;
  invite_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invites (trip_id, token_hash, created_by, expires_at)
  values (
    p_trip_id,
    encode(extensions.digest(invite_token, 'sha256'), 'hex'),
    auth.uid(),
    now() + make_interval(hours => greatest(1, least(p_expires_in_hours, 720)))
  );
  return invite_token;
end;
$$;

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched public.invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into matched
  from public.invites
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;
  if matched.id is null or matched.revoked_at is not null or matched.expires_at <= now()
    then raise exception 'Invite is invalid or expired';
  end if;
  if matched.used_at is not null then
    if matched.used_by = auth.uid() then return matched.trip_id; end if;
    raise exception 'Invite has already been used';
  end if;
  insert into public.trip_members (trip_id, user_id, role)
  values (matched.trip_id, auth.uid(), 'member')
  on conflict (trip_id, user_id) do nothing;
  update public.invites set used_at = now(), used_by = auth.uid()
  where id = matched.id;
  return matched.trip_id;
end;
$$;

revoke all on function public.create_trip(text) from public, anon;
revoke all on function public.create_invite(uuid, integer) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.create_trip(text) to authenticated;
grant execute on function public.create_invite(uuid, integer) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
