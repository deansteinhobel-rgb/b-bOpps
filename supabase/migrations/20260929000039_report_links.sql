-- Report links (Dean, 2026-09-29): a secret, view-only link to one report board of one client, for
-- embedding on a Notion page. Anyone with the link sees that board (and can change its period), and
-- nothing else. Admins, GTM leads and the client's account managers create links and turn them off.
-- Never deleted: turned off with revoked_at. The public page reads a link by its token with the
-- server's admin client, so there is no policy for signed-out visitors.
create table public.report_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  board text not null check (board in ('all', 'linkedin', 'google_ads', 'meta')),
  default_days int not null default 30 check (default_days in (7, 14, 30, 90)),
  label text check (length(label) <= 120),
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{32,}$'),
  created_by_profile_id uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_profile_id uuid references public.profiles (id),
  last_viewed_at timestamptz
);
create index report_links_client_idx on public.report_links (client_id, board);

-- Who may share a client's reports: admins and GTM leads, and the client's account managers.
create function public.can_share_reports(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (
    select 1 from public.client_team
    where client_id = cid and profile_id = auth.uid() and removed_at is null and role::text in ('am', 'gtm_lead')
  );
$$;
revoke execute on function public.can_share_reports(uuid) from public, anon;
grant execute on function public.can_share_reports(uuid) to authenticated;

alter table public.report_links enable row level security;
-- The client's team (not viewers) sees its links: a link is a key, so it stays with the people who can share.
create policy "report links: team reads" on public.report_links for select to authenticated using (public.can_edit_client(client_id));
create policy "report links: sharers create" on public.report_links for insert to authenticated
  with check (public.can_share_reports(client_id) and created_by_profile_id = (select auth.uid()) and revoked_at is null);
-- Updating only turns a link off: the other columns can't be changed.
create policy "report links: sharers turn off" on public.report_links for update to authenticated
  using (public.can_share_reports(client_id)) with check (public.can_share_reports(client_id) and revoked_at is not null);
revoke update on public.report_links from authenticated;
grant update (revoked_at, revoked_by_profile_id) on public.report_links to authenticated;
-- No delete policies.
