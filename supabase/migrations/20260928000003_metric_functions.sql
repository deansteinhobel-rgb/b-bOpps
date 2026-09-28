-- Aggregation helpers for the Overview tab and check pre-loads. All SECURITY INVOKER (the
-- default), so RLS on windsor_daily_metrics applies to the caller: no data leaks across clients.

-- Spend and results per platform/account per day.
create function public.platform_daily(p_client uuid, p_from date, p_to date)
returns table (
  platform public.platform, external_account_id text, date date,
  spend numeric, impressions bigint, clicks bigint, conversions numeric, leads numeric
)
language sql stable as $$
  select platform, external_account_id, date,
         sum(spend), sum(impressions)::bigint, sum(clicks)::bigint, sum(conversions), sum(leads)
  from public.windsor_daily_metrics
  where client_id = p_client and date between p_from and p_to
  group by platform, external_account_id, date
  order by date;
$$;

-- Per-ad totals over a period (best/worst ad, new creatives).
create function public.ad_stats(p_client uuid, p_from date, p_to date)
returns table (
  platform public.platform, external_account_id text, ad_id text, ad_name text, campaign_name text,
  spend numeric, impressions bigint, clicks bigint, conversions numeric, leads numeric
)
language sql stable as $$
  select platform, external_account_id, ad_id, max(ad_name), max(campaign_name),
         sum(spend), sum(impressions)::bigint, sum(clicks)::bigint, sum(conversions), sum(leads)
  from public.windsor_daily_metrics
  where client_id = p_client and date between p_from and p_to and ad_id <> ''
  group by platform, external_account_id, ad_id;
$$;

-- Ad fatigue inputs per ad: first/last seen, whether it is live (impressions in the account's
-- last 2 available days), CTR over the last 7 days and over its first 14 days.
create function public.ad_fatigue_inputs(p_client uuid)
returns table (
  platform public.platform, external_account_id text, ad_id text, ad_name text, campaign_name text,
  first_seen date, data_from date, data_through date, live boolean,
  recent_impressions bigint, recent_clicks bigint, recent_spend numeric,
  early_impressions bigint, early_clicks bigint
)
language sql stable as $$
  with ranges as (
    select platform, external_account_id, min(date) as data_from, max(date) as data_through
    from public.windsor_daily_metrics where client_id = p_client
    group by platform, external_account_id
  ),
  firsts as (
    select m.platform, m.external_account_id, m.ad_id, max(m.ad_name) as ad_name, max(m.campaign_name) as campaign_name,
           min(m.date) filter (where m.impressions > 0) as first_seen
    from public.windsor_daily_metrics m
    where m.client_id = p_client and m.ad_id <> ''
    group by m.platform, m.external_account_id, m.ad_id
  )
  select f.platform, f.external_account_id, f.ad_id, f.ad_name, f.campaign_name, f.first_seen,
         r.data_from, r.data_through,
         coalesce(sum(m.impressions) filter (where m.date > r.data_through - 2), 0) > 0 as live,
         coalesce(sum(m.impressions) filter (where m.date > r.data_through - 7), 0)::bigint,
         coalesce(sum(m.clicks) filter (where m.date > r.data_through - 7), 0)::bigint,
         coalesce(sum(m.spend) filter (where m.date > r.data_through - 7), 0),
         coalesce(sum(m.impressions) filter (where m.date < f.first_seen + 14), 0)::bigint,
         coalesce(sum(m.clicks) filter (where m.date < f.first_seen + 14), 0)::bigint
  from firsts f
  join ranges r using (platform, external_account_id)
  join public.windsor_daily_metrics m
    on m.client_id = p_client and m.platform = f.platform
   and m.external_account_id = f.external_account_id and m.ad_id = f.ad_id
  where f.first_seen is not null
  group by f.platform, f.external_account_id, f.ad_id, f.ad_name, f.campaign_name, f.first_seen, r.data_from, r.data_through;
$$;

grant execute on function public.platform_daily(uuid, date, date), public.ad_stats(uuid, date, date),
  public.ad_fatigue_inputs(uuid) to authenticated;
