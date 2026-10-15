-- Faster Sprint tab (2026-10-15). sprint_ad_events was written when we held 90 days of data; it grouped every ad
-- row the client has ever had (DNSFilter back to 2018) to find the few ads that started or stopped in a sprint.
--
-- Both kinds of event need an impression inside the range (first seen in it, or last seen in it), so the ads are
-- found from the range alone on the (client_id, date) index, and only those ads' own rows are read on the
-- (client, platform, account, ad, date) index, one ad at a time (no big sort). Each account's last day comes from
-- client_data_range instead of a scan.
--
-- Checked against the old function (2026-10-15): six sprint-length ranges from Nov 2025 to Oct 2026 for every
-- client, 384 rows, identical (no row only in one). DNSFilter, current sprint: ~26ms and 12.8k buffers instead of
-- ~414ms and 116k; previous sprint ~75ms instead of ~151ms (warm cache). In production the old one averaged 1.46s
-- over 138 calls (max 7.9s).
--
-- Still security invoker: RLS on windsor_daily_metrics decides what the caller sees.

create or replace function public.sprint_ad_events(p_client uuid, p_from date, p_to date)
returns table (
  platform public.platform, external_account_id text, ad_id text, ad_name text, campaign_name text,
  first_seen date, last_seen date, data_through date, spend_in_range numeric
)
language sql stable
set search_path = ''
as $$
  with ranges as materialized (
    select * from public.client_data_range(p_client)
  ),
  -- Ads with impressions inside the range: the only ones that can have started or stopped in it.
  candidates as materialized (
    select distinct m.platform, m.external_account_id, m.ad_id
      from public.windsor_daily_metrics m
     where m.client_id = p_client
       and m.date between p_from and p_to
       and m.ad_id <> '' and m.impressions > 0
  ),
  -- Each candidate's whole life, as before (first and last day with impressions, first day of any row).
  lifetimes as (
    select c.platform, c.external_account_id, c.ad_id, a.*
      from candidates c
      cross join lateral (
        select max(m.ad_name) as ad_name, max(m.campaign_name) as campaign_name,
               min(m.date) filter (where m.impressions > 0) as first_seen,
               max(m.date) filter (where m.impressions > 0) as last_seen,
               min(m.date) as data_from,
               sum(m.spend) filter (where m.date between p_from and p_to) as spend_in_range
          from public.windsor_daily_metrics m
         where m.client_id = p_client and m.platform = c.platform
           and m.external_account_id = c.external_account_id and m.ad_id = c.ad_id
      ) a
  )
  select l.platform, l.external_account_id, l.ad_id, l.ad_name, l.campaign_name, l.first_seen, l.last_seen,
         r.data_through, coalesce(l.spend_in_range, 0)
    from lifetimes l
    join ranges r on r.platform = l.platform and r.external_account_id = l.external_account_id
   where (l.first_seen between p_from and p_to and l.first_seen > l.data_from)
      or (l.last_seen between p_from and p_to and l.last_seen < r.data_through - 1);
$$;

grant execute on function public.sprint_ad_events(uuid, date, date) to authenticated;
