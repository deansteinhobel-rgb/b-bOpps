-- Per-ad totals across the whole client over a period (insights: ad CTR last 7 vs previous 7 days).
-- SECURITY INVOKER (the default): RLS on windsor_daily_metrics applies.
create function public.ad_totals(p_client uuid, p_from date, p_to date)
returns table (platform public.platform, external_account_id text, campaign_id text, campaign_name text, ad_id text, ad_name text,
               spend numeric, impressions bigint, clicks bigint, conversions numeric, leads numeric)
language sql stable as $$
  select platform, external_account_id, max(campaign_id), max(campaign_name), ad_id, max(ad_name),
         sum(spend), sum(impressions)::bigint, sum(clicks)::bigint, sum(conversions), sum(leads)
  from public.windsor_daily_metrics
  where client_id = p_client and ad_id <> '' and date between p_from and p_to
  group by platform, external_account_id, ad_id
  order by sum(impressions) desc;
$$;
grant execute on function public.ad_totals(uuid, date, date) to authenticated;
