create table if not exists public.trip_courses (
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_date date not null,
  course_id text not null,
  name text not null check (char_length(name) between 1 and 24),
  position integer not null default 0 check (position >= 0),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (trip_id, trip_date, course_id)
);

create index if not exists trip_courses_trip_date_idx
  on public.trip_courses (trip_id, trip_date, position);

alter table public.trip_courses enable row level security;

drop policy if exists "Members can read trip courses" on public.trip_courses;
drop policy if exists "Members can create trip courses" on public.trip_courses;
drop policy if exists "Members can update trip courses" on public.trip_courses;
drop policy if exists "Members can delete trip courses" on public.trip_courses;

create policy "Members can read trip courses" on public.trip_courses
for select using (public.is_trip_member(trip_id));

create policy "Members can create trip courses" on public.trip_courses
for insert with check (public.is_trip_member(trip_id) and updated_by = auth.uid());

create policy "Members can update trip courses" on public.trip_courses
for update using (public.is_trip_member(trip_id))
with check (public.is_trip_member(trip_id) and updated_by = auth.uid());

create policy "Members can delete trip courses" on public.trip_courses
for delete using (public.is_trip_member(trip_id));
