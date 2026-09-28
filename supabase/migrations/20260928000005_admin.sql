-- Admin area support.
-- Team removals are soft (removed_at), in keeping with "nothing gets deleted": history is kept.
alter table public.client_team add column removed_at timestamptz;
alter table public.client_team_invites add column removed_at timestamptz;

-- Access only counts active team membership.
create or replace function public.can_access_client(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (
    select 1 from public.client_team
    where client_id = cid and profile_id = auth.uid() and removed_at is null
  );
$$;

-- Sign-up: removed invites don't grant access.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  inv public.team_invites;
begin
  if lower(new.email) not like '%@bordeauxandburgundy.co.uk' then
    raise exception 'Only @bordeauxandburgundy.co.uk accounts can sign in';
  end if;

  select * into inv from public.team_invites where email = lower(new.email);

  insert into public.profiles (id, email, full_name, role, notion_user_id)
  values (new.id, lower(new.email), inv.full_name, inv.role, inv.notion_user_id);

  insert into public.client_team (client_id, profile_id, role)
  select client_id, new.id, role from public.client_team_invites
  where email = lower(new.email) and removed_at is null
  on conflict do nothing;

  return new;
end $$;

-- Admins can update (e.g. soft-remove) team rows. Still no DELETE policies anywhere.
create policy "client_team: admin updates" on public.client_team for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
