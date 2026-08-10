-- pgcrypto is installed in Supabase's `extensions` schema. These security
-- definer functions intentionally use an empty search_path, so extension
-- functions must be schema-qualified.
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

  insert into public.trip_members (trip_id, user_id, role)
  values (matched.trip_id, auth.uid(), 'member')
  on conflict (trip_id, user_id) do nothing;

  -- Keep the most recent redemption for operational visibility. A valid link
  -- remains reusable by other authenticated users until it expires or is revoked.
  update public.invites set used_at = now(), used_by = auth.uid()
  where id = matched.id;

  return matched.trip_id;
end;
$$;

revoke all on function public.create_invite(uuid, integer) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.create_invite(uuid, integer) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
