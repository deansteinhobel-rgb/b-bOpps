-- Totals of one breakdown kind over a period, optionally for one campaign (Performance tab).
-- `extra` is the most recent day's extra values (quality score, reach / frequency, learning stage).
-- SECURITY INVOKER (the default): RLS on windsor_breakdowns applies.
create function public.breakdown_totals(p_client uuid, p_kind text, p_from date, p_to date, p_campaign text default null)
returns table (campaign_id text, campaign_name text, group_id text, group_name text, dim1 text, dim2 text,
               spend numeric, impressions bigint, clicks bigint, conversions numeric, leads numeric, days bigint, extra jsonb)
language sql stable as $$
  select campaign_id, max(campaign_name), group_id, max(group_name), dim1, dim2,
         sum(spend), sum(impressions)::bigint, sum(clicks)::bigint, sum(conversions), sum(leads),
         count(distinct date), (array_agg(extra order by date desc))[1]
  from public.windsor_breakdowns
  where client_id = p_client and kind = p_kind and date between p_from and p_to
    and (p_campaign is null or campaign_id = p_campaign)
  group by campaign_id, group_id, dim1, dim2
  order by sum(spend) desc, sum(impressions) desc;
$$;
grant execute on function public.breakdown_totals(uuid, text, date, date, text) to authenticated;
