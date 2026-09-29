-- Performance tab (phase 1). SECURITY INVOKER (the default): RLS on windsor_daily_metrics applies.

-- Daily totals per campaign (campaign table, trends, campaign drill-down).
create function public.campaign_daily(p_client uuid, p_from date, p_to date)
returns table (platform public.platform, campaign_id text, campaign_name text, date date,
               spend numeric, impressions bigint, clicks bigint, conversions numeric, leads numeric)
language sql stable as $$
  select platform, campaign_id, max(campaign_name), date,
         sum(spend), sum(impressions)::bigint, sum(clicks)::bigint, sum(conversions), sum(leads)
  from public.windsor_daily_metrics
  where client_id = p_client and date between p_from and p_to and campaign_id <> ''
  group by platform, campaign_id, date
  order by date;
$$;

-- Per-ad totals for one campaign over a period (the drill-down's ads table).
create function public.campaign_ads(p_client uuid, p_platform public.platform, p_campaign_id text, p_from date, p_to date)
returns table (platform public.platform, external_account_id text, ad_id text, ad_name text,
               spend numeric, impressions bigint, clicks bigint, conversions numeric, leads numeric, first_date date, last_date date)
language sql stable as $$
  select platform, external_account_id, ad_id, max(ad_name),
         sum(spend), sum(impressions)::bigint, sum(clicks)::bigint, sum(conversions), sum(leads), min(date), max(date)
  from public.windsor_daily_metrics
  where client_id = p_client and platform = p_platform and campaign_id = p_campaign_id and ad_id <> ''
    and date between p_from and p_to
  group by platform, external_account_id, ad_id
  order by sum(spend) desc;
$$;

grant execute on function public.campaign_daily(uuid, date, date), public.campaign_ads(uuid, public.platform, text, date, date) to authenticated;
