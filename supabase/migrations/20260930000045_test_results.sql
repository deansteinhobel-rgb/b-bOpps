-- Live test results (Dean, 2026-09-30): what kind of test it is, which ads are the test, and Claude's daily read.

-- new_campaign = built from scratch; change = new ads (or other changes) in an established campaign.
-- test_ad_ids: the test's ads for a "change" test (empty = every ad first seen on or after the live date).
alter table public.sprint_tests
  add column test_kind text check (test_kind in ('new_campaign', 'change')),
  add column test_ad_ids text[] not null default '{}';

-- One read per test per day. Written by the server (secret key) after checking the user can see the
-- client. No deletes.
create table public.test_reads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  sprint_test_id uuid not null references public.sprint_tests (id),
  read_on date not null,
  verdict text not null check (verdict in ('too_early', 'working', 'not_yet', 'hurting')),
  confidence text check (confidence in ('low', 'medium', 'high')),
  headline text not null,
  points jsonb not null default '[]',
  next_step text,
  next_step_kind text check (next_step_kind in ('keep_running', 'scale', 'fix', 'call_it')),
  model text,
  usage jsonb,
  requested_by_profile_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (sprint_test_id, read_on)
);
create index test_reads_client_idx on public.test_reads (client_id);
alter table public.test_reads enable row level security;
create policy "test reads: read assigned" on public.test_reads for select to authenticated using ((select public.can_access_client(client_id)));

-- Per-ad totals for a test's campaigns over a period, with the day each ad first had impressions (any time).
create function public.test_ads(p_client uuid, p_platform public.platform, p_campaign_ids text[], p_from date, p_to date)
returns table (platform public.platform, external_account_id text, campaign_id text, ad_id text, ad_name text, first_seen date,
               spend numeric, impressions bigint, clicks bigint, conversions numeric, leads numeric)
language sql stable set search_path = '' as $$
  with firsts as (
    select m.platform, m.external_account_id, m.ad_id, min(m.date) filter (where m.impressions > 0) as first_seen
    from public.windsor_daily_metrics m
    where m.client_id = p_client and (p_platform is null or m.platform = p_platform)
      and m.campaign_id = any (p_campaign_ids) and m.ad_id <> ''
    group by m.platform, m.external_account_id, m.ad_id
  )
  select m.platform, m.external_account_id, max(m.campaign_id), m.ad_id, max(m.ad_name), f.first_seen,
         sum(m.spend), sum(m.impressions)::bigint, sum(m.clicks)::bigint, sum(m.conversions), sum(m.leads)
  from public.windsor_daily_metrics m
  join firsts f on f.platform = m.platform and f.external_account_id = m.external_account_id and f.ad_id = m.ad_id
  where m.client_id = p_client and (p_platform is null or m.platform = p_platform)
    and m.campaign_id = any (p_campaign_ids) and m.ad_id <> '' and m.date between p_from and p_to
  group by m.platform, m.external_account_id, m.ad_id, f.first_seen
  order by sum(m.spend) desc;
$$;
grant execute on function public.test_ads(uuid, public.platform, text[], date, date) to authenticated;
