-- Phase 3 of the Performance tab (Dean, 2026-09-29): the "Optimise now" insights feed.
-- Insights themselves are computed from our Windsor data by rules (src/lib/insights/rules.ts), so they
-- are never stored. What IS stored is what the team did with each one: an append-only log (no updates,
-- no deletes), which also gives us the data to tune the rules later.
--   done / dismissed  hide the items they covered (search terms, companies, weeks...); new items bring it back
--   snoozed           hides the whole insight until snooze_until
--   briefed / tested  a Notion action or a sprint test was made from it (it moves to "In hand")
--   reopened          cancels everything logged before it for that insight

create table public.insight_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  insight_key text not null,                 -- e.g. negatives:google_ads:123456
  rule text not null,                        -- e.g. negatives
  action text not null check (action in ('done', 'dismissed', 'snoozed', 'briefed', 'tested', 'reopened')),
  items text[] not null default '{}',        -- the item ids this covers (empty = the whole insight)
  snooze_until date,
  note text,                                 -- why it was dismissed, or anything worth keeping
  snapshot jsonb,                            -- the insight as it was (title, numbers, items) for later analysis
  notion_log_id bigint,                      -- the notion_write_log row when briefed
  notion_page_id text,
  sprint_test_id uuid references public.sprint_tests (id),
  profile_id uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index insight_actions_client_idx on public.insight_actions (client_id, insight_key, created_at);

alter table public.insight_actions enable row level security;
create policy "insight actions: read assigned" on public.insight_actions for select to authenticated using (public.can_access_client(client_id));
create policy "insight actions: team logs" on public.insight_actions for insert to authenticated
  with check (public.can_access_client(client_id) and profile_id = auth.uid());
-- No update or delete policies: the log is append-only.

-- Sprint tests made from an insight stay traceable, like the ones from Pour a Sprint.
alter table public.sprint_tests add column insight_key text;

-- Meta ad sets over the last 7 days as ONE total (daily reach can't be added up, so the 7-day frequency
-- needs its own report).
alter table public.windsor_breakdowns drop constraint windsor_breakdowns_kind_check;
alter table public.windsor_breakdowns add constraint windsor_breakdowns_kind_check check (kind in (
  'search_term', 'keyword', 'impression_share',
  'li_company', 'li_job_title', 'li_seniority', 'li_industry', 'li_job_function',
  'meta_age_gender', 'meta_placement', 'meta_adset', 'meta_adset_7d',
  'ga4_landing_page'
));

-- Search terms worth a look over a period, per campaign (all ad groups and match types together):
-- spent at least p_min_spend with no results, or brought in p_min_results or more. `is_keyword` says
-- whether the campaign already has it as a keyword (same text, any match type).
-- SECURITY INVOKER (the default): RLS on windsor_breakdowns applies.
create function public.search_term_candidates(p_client uuid, p_from date, p_to date, p_min_spend numeric, p_min_results numeric)
returns table (campaign_id text, campaign_name text, term text, spend numeric, impressions bigint, clicks bigint, results numeric, is_keyword boolean)
language sql stable as $$
  with t as (
    select campaign_id, max(campaign_name) as campaign_name, lower(dim1) as term,
           sum(spend) as spend, sum(impressions)::bigint as impressions, sum(clicks)::bigint as clicks, sum(conversions + leads) as results
    from public.windsor_breakdowns
    where client_id = p_client and kind = 'search_term' and date between p_from and p_to
    group by campaign_id, lower(dim1)
  ), k as (
    select distinct campaign_id, lower(dim1) as term
    from public.windsor_breakdowns
    where client_id = p_client and kind = 'keyword' and date between p_from - 60 and p_to
  )
  select t.campaign_id, t.campaign_name, t.term, t.spend, t.impressions, t.clicks, t.results,
         exists (select 1 from k where k.campaign_id = t.campaign_id and k.term = t.term) as is_keyword
  from t
  where (t.results = 0 and t.spend >= p_min_spend) or t.results >= p_min_results
  order by t.spend desc;
$$;
grant execute on function public.search_term_candidates(uuid, date, date, numeric, numeric) to authenticated;
