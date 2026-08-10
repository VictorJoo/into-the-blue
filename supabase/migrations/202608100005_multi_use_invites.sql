-- A group-chat invite remains reusable by multiple authenticated users until
-- its existing expiry or revocation condition is reached.
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

  -- These legacy columns now record the most recent redemption instead of
  -- making the link single-use.
  update public.invites set used_at = now(), used_by = auth.uid()
  where id = matched.id;

  return matched.trip_id;
end;
$$;

revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;
