-- When a client's synced data last changed: the latest Windsor sync run, breakdown pull or campaign
-- status check. The cached numbers (Overview, Performance, Optimise now) include it in their cache key,
-- so any sync, including one run from the command line, shows up straight away (Dean, 2026-09-29).
-- SECURITY INVOKER (the default): RLS applies to the caller.
create function public.client_data_stamp(p_client uuid)
returns text
language sql stable as $$
  select coalesce(greatest(
    (select max(coalesce(finished_at, started_at)) from public.windsor_sync_runs where client_id = p_client),
    (select max(synced_at) from public.breakdown_sync_state where client_id = p_client),
    (select max(checked_at) from public.campaign_statuses where client_id = p_client)
  )::text, 'none');
$$;
grant execute on function public.client_data_stamp(uuid) to authenticated;
