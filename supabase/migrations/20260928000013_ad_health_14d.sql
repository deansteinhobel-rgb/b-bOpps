-- Ad fatigue inputs, v2 (Dean): compare an ad's first 14 days with its LAST 14 days (was 7),
-- for CTR and for cost per result, so both windows also carry spend, conversions and leads.
-- The return columns change, so the function is dropped and recreated (no data involved).
drop function if exists public.ad_fatigue_inputs(uuid);

create function public.ad_fatigue_inputs(p_client uuid)
returns table (
  platform public.platform, external_account_id text, ad_id text, ad_name text, campaign_name text,
  first_seen date, data_from date, data_through date, live boolean,
  recent_impressions bigint, recent_clicks bigint, recent_spend numeric, recent_conversions numeric, recent_leads numeric,
  early_impressions bigint, early_clicks bigint, early_spend numeric, early_conversions numeric, early_leads numeric
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
         coalesce(sum(m.impressions) filter (where m.date > r.data_through - 14), 0)::bigint,
         coalesce(sum(m.clicks) filter (where m.date > r.data_through - 14), 0)::bigint,
         coalesce(sum(m.spend) filter (where m.date > r.data_through - 14), 0),
         coalesce(sum(m.conversions) filter (where m.date > r.data_through - 14), 0),
         coalesce(sum(m.leads) filter (where m.date > r.data_through - 14), 0),
         coalesce(sum(m.impressions) filter (where m.date < f.first_seen + 14), 0)::bigint,
         coalesce(sum(m.clicks) filter (where m.date < f.first_seen + 14), 0)::bigint,
         coalesce(sum(m.spend) filter (where m.date < f.first_seen + 14), 0),
         coalesce(sum(m.conversions) filter (where m.date < f.first_seen + 14), 0),
         coalesce(sum(m.leads) filter (where m.date < f.first_seen + 14), 0)
  from firsts f
  join ranges r using (platform, external_account_id)
  join public.windsor_daily_metrics m
    on m.client_id = p_client and m.platform = f.platform
   and m.external_account_id = f.external_account_id and m.ad_id = f.ad_id
  where f.first_seen is not null
  group by f.platform, f.external_account_id, f.ad_id, f.ad_name, f.campaign_name, f.first_seen, r.data_from, r.data_through;
$$;

grant execute on function public.ad_fatigue_inputs(uuid) to authenticated;
