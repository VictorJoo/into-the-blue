create or replace function public.rename_trip(p_trip_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  next_name := nullif(trim(p_name), '');
  if next_name is null then
    raise exception 'Trip name is required';
  end if;
  if char_length(next_name) > 40 then
    raise exception 'Trip name is too long';
  end if;

  update public.trips
  set name = next_name, updated_at = now()
  where id = p_trip_id and owner_id = auth.uid();

  if not found then
    raise exception 'Only the trip owner can rename this trip';
  end if;
end;
$$;

revoke all on function public.rename_trip(uuid, text) from public, anon;
grant execute on function public.rename_trip(uuid, text) to authenticated;
