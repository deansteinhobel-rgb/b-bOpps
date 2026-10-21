-- The DNSFilter page timed out (2026-10-21, "Couldn't read the data range"): client_data_range ran
-- with the caller's rights, so the metrics read policy (client_id in my_client_ids()) was checked on
-- every row and the first/last day lookups walked ~40k index pages: 5.6s for a signed-in user
-- against 28ms for the server, close to the 8s statement limit. Now the function checks access
-- once, up front, and reads with its owner's rights: 7ms. Same rows as before for everyone: the
-- server (secret key), or a signed-in user who can access the client; anyone else gets none.
create or replace function public.client_data_range(p_client uuid)
returns table (platform public.platform, external_account_id text, data_from date, data_through date)
language sql stable security definer set search_path = '' as $$
  with recursive accts as (
    (select m.platform, m.external_account_id
       from public.windsor_daily_metrics m
      where m.client_id = p_client
      order by m.platform, m.external_account_id
      limit 1)
    union all
    select n.platform, n.external_account_id
      from accts a
      cross join lateral (
        select m.platform, m.external_account_id
          from public.windsor_daily_metrics m
         where m.client_id = p_client
           and (m.platform, m.external_account_id) > (a.platform, a.external_account_id)
         order by m.platform, m.external_account_id
         limit 1
      ) n
  )
  select a.platform, a.external_account_id,
         (select min(m.date) from public.windsor_daily_metrics m
           where m.client_id = p_client and m.platform = a.platform and m.external_account_id = a.external_account_id),
         (select max(m.date) from public.windsor_daily_metrics m
           where m.client_id = p_client and m.platform = a.platform and m.external_account_id = a.external_account_id)
    from accts a
   where (select auth.role()) = 'service_role' or (select public.can_access_client(p_client));
$$;

revoke all on function public.client_data_range(uuid) from public, anon;
grant execute on function public.client_data_range(uuid) to authenticated, service_role;
