create table if not exists public.trip_candidate_pools (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  candidates jsonb not null default '[]'::jsonb,
  seed_version integer not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint trip_candidate_pools_candidates_array
    check (jsonb_typeof(candidates) = 'array')
);

alter table public.trip_candidate_pools enable row level security;

drop policy if exists "Members can read candidate pools" on public.trip_candidate_pools;
drop policy if exists "Members can create candidate pools" on public.trip_candidate_pools;
drop policy if exists "Members can update candidate pools" on public.trip_candidate_pools;
drop policy if exists "Members can delete candidate pools" on public.trip_candidate_pools;

create policy "Members can read candidate pools" on public.trip_candidate_pools
for select using (public.is_trip_member(trip_id));

create policy "Members can create candidate pools" on public.trip_candidate_pools
for insert with check (public.is_trip_member(trip_id) and updated_by = auth.uid());

create policy "Members can update candidate pools" on public.trip_candidate_pools
for update using (public.is_trip_member(trip_id))
with check (public.is_trip_member(trip_id) and updated_by = auth.uid());

create policy "Members can delete candidate pools" on public.trip_candidate_pools
for delete using (public.is_trip_member(trip_id));
