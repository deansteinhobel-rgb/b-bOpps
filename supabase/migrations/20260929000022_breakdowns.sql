-- Phase 2 of the Performance tab (Dean, 2026-09-29): the detail behind the insights.
--   Google Ads: search terms, keywords (with quality score), impression share per campaign (daily)
--   LinkedIn:   who saw and clicked the ads, by company, job title, seniority, industry and job
--               function (30-day totals, refreshed weekly: these reports take minutes each)
--   Meta:       age and gender, placement, and reach / frequency / learning stage per ad set (daily)
--   GA4:        landing pages by source / medium and campaign (daily; Camber only for now)
-- One client-scoped table; `kind` says what a row is and `extra` holds kind-specific numbers.

alter table public.clients add column ga4_property_id text;

create table public.windsor_breakdowns (
  id bigserial primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  source text not null check (source in ('google_ads', 'linkedin', 'meta', 'ga4')),
  external_account_id text not null,
  kind text not null check (kind in (
    'search_term', 'keyword', 'impression_share',
    'li_company', 'li_job_title', 'li_seniority', 'li_industry', 'li_job_function',
    'meta_age_gender', 'meta_placement', 'meta_adset',
    'ga4_landing_page'
  )),
  date date not null,              -- the day, or the last day of a LinkedIn 30-day total
  campaign_id text not null default '',
  campaign_name text,
  group_id text not null default '',   -- ad group (Google) or ad set (Meta)
  group_name text,
  dim1 text not null default '',   -- search term, keyword, company, job title, age, publisher, landing page
  dim2 text not null default '',   -- match type, gender, position, source / medium
  spend numeric(14, 4) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions numeric(14, 4) not null default 0,
  leads numeric(14, 4) not null default 0,
  extra jsonb,                     -- quality score, impression share, reach/frequency, GA4 sessions...
  synced_at timestamptz not null default now(),
  unique (client_id, source, external_account_id, kind, date, campaign_id, group_id, dim1, dim2)
);
create index windsor_breakdowns_lookup_idx on public.windsor_breakdowns (client_id, kind, date);

alter table public.windsor_breakdowns enable row level security;
create policy "breakdowns: read assigned" on public.windsor_breakdowns for select to authenticated using (public.can_access_client(client_id));
-- Written by the sync (secret key) only. No deletes.

-- When each LinkedIn breakdown was last pulled, so the weekly job takes the stalest first.
create table public.breakdown_sync_state (
  client_id uuid not null references public.clients (id) on delete cascade,
  source text not null,
  external_account_id text not null,
  kind text not null,
  synced_through date,
  synced_at timestamptz,
  error text,
  primary key (client_id, source, external_account_id, kind)
);
alter table public.breakdown_sync_state enable row level security;
create policy "breakdown state: read assigned" on public.breakdown_sync_state for select to authenticated using (public.can_access_client(client_id));
