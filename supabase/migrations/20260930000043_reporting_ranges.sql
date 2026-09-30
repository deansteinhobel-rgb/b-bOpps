-- Reporting date ranges (Dean, 2026-09-30): custom ranges and presets up to all time.

-- Campaign totals by day, week (Monday) or month, never starting before p_from. Long ranges are
-- charted by week or month, so "all time" doesn't read tens of thousands of daily rows.
-- SECURITY INVOKER (the default): RLS on windsor_daily_metrics applies.
create function public.campaign_series(p_client uuid, p_from date, p_to date, p_bucket text)
returns table (platform public.platform, campaign_id text, campaign_name text, date date,
               spend numeric, impressions bigint, clicks bigint, conversions numeric, leads numeric)
language sql stable
set search_path = ''
as $$
  select platform, campaign_id, max(campaign_name),
         greatest(date_trunc(case when p_bucket in ('week', 'month') then p_bucket else 'day' end, date)::date, p_from) as bucket,
         sum(spend), sum(impressions)::bigint, sum(clicks)::bigint, sum(conversions), sum(leads)
  from public.windsor_daily_metrics
  where client_id = p_client and date between p_from and p_to and campaign_id <> ''
  group by platform, campaign_id, bucket
  order by bucket;
$$;
grant execute on function public.campaign_series(uuid, date, date, text) to authenticated;

-- An embed can open on a preset or fixed dates ("qtd", "2026-07-01..2026-09-30"); null = default_days.
alter table public.report_links add column default_range text
  check (default_range is null or default_range ~ '^(mtd|last_month|qtd|last_quarter|ytd|last_year|all|\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})$');
