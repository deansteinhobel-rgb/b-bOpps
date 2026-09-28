-- Month-to-date spend per campaign, plus spend on the last two days (for campaign-level pacing and
-- the zero-spend rule). SECURITY INVOKER: RLS on windsor_daily_metrics applies.
create function public.campaign_month(p_client uuid, p_from date, p_to date)
returns table (platform public.platform, campaign_id text, campaign_name text, spend numeric, spend_last2 numeric, last_date date)
language sql stable as $$
  select platform, campaign_id, max(campaign_name),
         sum(spend) filter (where date between p_from and p_to),
         coalesce(sum(spend) filter (where date > p_to - 2 and date <= p_to), 0),
         max(date)
  from public.windsor_daily_metrics
  where client_id = p_client and date between p_from and p_to and campaign_id <> ''
  group by platform, campaign_id
  order by sum(spend) desc;
$$;
grant execute on function public.campaign_month(uuid, date, date) to authenticated;
