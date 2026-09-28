-- Let the team see who's invited (name, role, Notion user) so people who haven't signed in yet can
-- still be picked as an action owner. Still read-only for non-admins.
create policy "team_invites: team reads" on public.team_invites for select to authenticated
  using (public.has_role());
create policy "client_team_invites: read assigned" on public.client_team_invites for select to authenticated
  using (public.can_access_client(client_id));
