-- GA4 landing pages over a period, by page and source / medium (Performance tab). SECURITY INVOKER.
create function public.ga4_landing_totals(p_client uuid, p_from date, p_to date)
returns table (page text, source_medium text, sessions numeric, engaged numeric, conversions numeric, avg_duration numeric)
language sql stable as $$
  select dim1, dim2,
         sum((extra->>'sessions')::numeric), sum((extra->>'engaged_sessions')::numeric), sum(conversions),
         sum((extra->>'average_session_duration')::numeric * (extra->>'sessions')::numeric) / nullif(sum((extra->>'sessions')::numeric), 0)
  from public.windsor_breakdowns
  where client_id = p_client and kind = 'ga4_landing_page' and date between p_from and p_to
  group by dim1, dim2
  order by 3 desc nulls last;
$$;
grant execute on function public.ga4_landing_totals(uuid, date, date) to authenticated;
