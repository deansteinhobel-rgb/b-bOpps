-- Faster page loads, DNSFilter above all (2026-10-15). Both queries below were written when we held 90 days of
-- data; with history back to 2018 they read every row the client has ever had (DNSFilter: 115k rows).
--
-- 1. client_data_range(p_client): the same rows as the account_data_range view for one client (first and last
--    day per ad account), from a handful of probes on the existing (platform, account, date) key instead of a
--    scan of the whole history. The app reads this on almost every page.
-- 2. ad_fatigue_inputs only looks at ads with impressions in the last 62 days of their account's data: every
--    live ad, and every ad first seen this month or last week (new creatives, the naming check). Older ads that
--    have stopped are never used, so leaving them out changes nothing on screen.
--
-- Checked against the old function on DNSFilter (2026-10-15): the same 108 live ads with identical numbers, no
-- recent ad missing, 292 rows instead of 2,335, ~0.2s instead of ~4.5s.
--
-- Both stay security invoker: RLS on windsor_daily_metrics still decides what the caller sees.

create function public.client_data_range(p_client uuid)
returns table (platform public.platform, external_account_id text, data_from date, data_through date)
language sql stable
set search_path = ''
as $$
  -- The client's ad accounts, one index probe each (a loose index scan; there's no DISTINCT that uses the index).
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
   -- Checked once, before the scan: a client the caller can't see returns nothing straight away.
   where exists (select 1 from public.clients c where c.id = p_client);
$$;

grant execute on function public.client_data_range(uuid) to authenticated;

create or replace function public.ad_fatigue_inputs(p_client uuid)
returns table (
  platform public.platform, external_account_id text, ad_id text, ad_name text, campaign_name text,
  first_seen date, data_from date, data_through date, live boolean,
  recent_impressions bigint, recent_clicks bigint, recent_spend numeric, recent_conversions numeric, recent_leads numeric,
  early_impressions bigint, early_clicks bigint, early_spend numeric, early_conversions numeric, early_leads numeric
)
language sql stable
set search_path = ''
as $$
  with ranges as materialized (
    select * from public.client_data_range(p_client)
  ),
  -- Ads with impressions in the last 62 days of their account. The date bound on the client first lets the
  -- (client_id, date) index do the work; the join then applies each account's own window.
  recent as materialized (
    select distinct r.platform, r.external_account_id, m.ad_id, r.data_from, r.data_through
      from public.windsor_daily_metrics m
      join ranges r
        on m.platform = r.platform and m.external_account_id = r.external_account_id and m.date > r.data_through - 62
     where m.client_id = p_client
       and m.date > (select min(data_through) from ranges) - 62
       and m.ad_id <> '' and m.impressions > 0
  ),
  -- Every day those ads ever ran, with each ad's first day with impressions (one pass, not a lookup per row).
  days as (
    select f.platform, f.external_account_id, f.ad_id, f.data_from, f.data_through,
           m.date, m.ad_name, m.campaign_name, m.impressions, m.clicks, m.spend, m.conversions, m.leads,
           min(m.date) filter (where m.impressions > 0) over (partition by f.platform, f.external_account_id, f.ad_id) as first_seen
      from recent f
      join public.windsor_daily_metrics m
        on m.client_id = p_client and m.platform = f.platform
       and m.external_account_id = f.external_account_id and m.ad_id = f.ad_id
  )
  select d.platform, d.external_account_id, d.ad_id, max(d.ad_name), max(d.campaign_name), d.first_seen,
         d.data_from, d.data_through,
         coalesce(sum(d.impressions) filter (where d.date > d.data_through - 2), 0) > 0 as live,
         coalesce(sum(d.impressions) filter (where d.date > d.data_through - 14), 0)::bigint,
         coalesce(sum(d.clicks) filter (where d.date > d.data_through - 14), 0)::bigint,
         coalesce(sum(d.spend) filter (where d.date > d.data_through - 14), 0),
         coalesce(sum(d.conversions) filter (where d.date > d.data_through - 14), 0),
         coalesce(sum(d.leads) filter (where d.date > d.data_through - 14), 0),
         coalesce(sum(d.impressions) filter (where d.date < d.first_seen + 14), 0)::bigint,
         coalesce(sum(d.clicks) filter (where d.date < d.first_seen + 14), 0)::bigint,
         coalesce(sum(d.spend) filter (where d.date < d.first_seen + 14), 0),
         coalesce(sum(d.conversions) filter (where d.date < d.first_seen + 14), 0),
         coalesce(sum(d.leads) filter (where d.date < d.first_seen + 14), 0)
    from days d
   group by d.platform, d.external_account_id, d.ad_id, d.first_seen, d.data_from, d.data_through;
$$;
