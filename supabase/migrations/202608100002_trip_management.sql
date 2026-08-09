create or replace function public.delete_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.trips
    where id = p_trip_id and owner_id = auth.uid()
  ) then
    raise exception 'Only the trip owner can delete this trip';
  end if;

  delete from public.trips where id = p_trip_id;
end;
$$;

revoke all on function public.delete_trip(uuid) from public, anon;
grant execute on function public.delete_trip(uuid) to authenticated;
