-- Google Places UI Kit coordinates may be cached for at most 30 days.
-- Place IDs remain stored with itinerary documents and may be retained indefinitely.
create table if not exists public.place_location_cache (
  google_place_id text not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  refreshed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (google_place_id, user_id)
);

create index if not exists place_location_cache_expiry_idx
  on public.place_location_cache (expires_at);

alter table public.place_location_cache enable row level security;

drop policy if exists "Authenticated users can read current place coordinates" on public.place_location_cache;
drop policy if exists "Authenticated users can cache place coordinates" on public.place_location_cache;
drop policy if exists "Authenticated users can refresh place coordinates" on public.place_location_cache;

create policy "Authenticated users can read current place coordinates"
on public.place_location_cache for select to authenticated
using (user_id = auth.uid() and expires_at > now());

create policy "Authenticated users can cache place coordinates"
on public.place_location_cache for insert to authenticated
with check (
  user_id = auth.uid()
  and
  refreshed_at <= now() + interval '5 minutes'
  and expires_at > now()
  and expires_at <= refreshed_at + interval '30 days'
);

create policy "Authenticated users can refresh place coordinates"
on public.place_location_cache for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and
  refreshed_at <= now() + interval '5 minutes'
  and expires_at > now()
  and expires_at <= refreshed_at + interval '30 days'
);

-- Private Realtime Presence authorization. The channel topic is trip-location:<trip uuid>.
drop policy if exists "Trip members can receive location presence" on realtime.messages;
drop policy if exists "Trip members can publish location presence" on realtime.messages;

create policy "Trip members can receive location presence"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'presence'
  and (select realtime.topic()) ~ '^trip-location:[0-9a-fA-F-]{36}$'
  and public.is_trip_member(split_part((select realtime.topic()), ':', 2)::uuid)
);

create policy "Trip members can publish location presence"
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension = 'presence'
  and (select realtime.topic()) ~ '^trip-location:[0-9a-fA-F-]{36}$'
  and public.is_trip_member(split_part((select realtime.topic()), ':', 2)::uuid)
);
