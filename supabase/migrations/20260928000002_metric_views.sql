-- Per-ad first/last seen dates and lifetime totals, for ad fatigue and "new creatives this month".
-- security_invoker: the view runs with the caller's rights, so RLS on windsor_daily_metrics applies.
-- first_seen is only as old as our cache (the 90-day backfill); the UI says so.
create view public.ad_lifetimes with (security_invoker = true) as
select
  client_id,
  platform,
  external_account_id,
  ad_id,
  max(ad_name) as ad_name,
  max(campaign_name) as campaign_name,
  min(date) filter (where impressions > 0) as first_seen,
  max(date) filter (where impressions > 0) as last_seen
from public.windsor_daily_metrics
where ad_id <> ''
group by client_id, platform, external_account_id, ad_id;

-- The earliest and latest date we hold per account ("data through", and the backfill horizon).
create view public.account_data_range with (security_invoker = true) as
select client_id, platform, external_account_id, min(date) as data_from, max(date) as data_through
from public.windsor_daily_metrics
group by client_id, platform, external_account_id;

grant select on public.ad_lifetimes, public.account_data_range to authenticated;
