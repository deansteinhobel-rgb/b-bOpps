-- Fast RLS on the big per-client tables (2026-10-01). Their policies called can_access_client(client_id)
-- for every row, and that function runs its own lookups each time. With full histories loaded
-- (163k metric rows; DNSFilter back to 2018) a signed-in read of account_data_range passed the 8s
-- statement timeout, so At a glance and Reporting showed "No ad data yet".
-- my_client_ids() returns the clients this person can see, worked out once per query (a hashed
-- subplan). Same rule as can_access_client: admins, GTM leads and viewers see every client, the
-- team sees its clients (removed members excluded). Policies are replaced, not loosened.
create or replace function public.my_client_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.clients where public.is_admin() or public.is_viewer()
  union
  select client_id from public.client_team where profile_id = auth.uid() and removed_at is null
$$;
revoke execute on function public.my_client_ids() from public, anon;
grant execute on function public.my_client_ids() to authenticated;

drop policy "metrics: read assigned" on public.windsor_daily_metrics;
create policy "metrics: read assigned" on public.windsor_daily_metrics for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy "breakdowns: read assigned" on public.windsor_breakdowns;
create policy "breakdowns: read assigned" on public.windsor_breakdowns for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy "creatives: read assigned" on public.ad_creatives;
create policy "creatives: read assigned" on public.ad_creatives for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy "campaign statuses: read assigned" on public.campaign_statuses;
create policy "campaign statuses: read assigned" on public.campaign_statuses for select to authenticated
  using (client_id in (select public.my_client_ids()));
