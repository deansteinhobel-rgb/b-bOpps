-- Sprint tests (Dean, 2026-09-28): the unit of a sprint.
--   planned → briefed (Notion brief created; in production) → ready (Notion "Client Approved" or
--   "Production Complete") → live (marked live, linked to campaigns) → review (findings) →
--   outcome: proven | disproven | inconclusive | carried (with a reason, copied into next sprint).
create type public.test_status as enum ('planned', 'briefed', 'ready', 'live', 'review', 'closed');
create type public.test_outcome as enum ('proven', 'disproven', 'inconclusive', 'carried');
create type public.carry_reason as enum ('deadline', 'setup_time', 'too_short_live', 'awaiting_approval', 'other');

create table public.sprint_tests (
  id uuid primary key default gen_random_uuid(),
  sprint_id uuid not null references public.sprints (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  platform public.platform,                 -- null = several / all platforms
  title text not null,                      -- what we're testing
  hypothesis text,
  assets text[] not null default '{}',      -- what to brief in: ad_creative, ad_copy, landing_page, ...
  brief_notes text,
  success_metric text,                      -- cost_per_result | ctr | results | cpc | other
  success_target numeric(14, 4),
  success_text text,                        -- "what success looks like", in words
  owner_notion_user_id text,
  owner_name text,
  deadline date,
  status public.test_status not null default 'planned',
  notion_page_id text,
  briefed_at timestamptz,
  ready_at timestamptz,
  live_on date,
  campaign_ids text[] not null default '{}',
  campaign_names text[] not null default '{}',
  findings_worked text,
  findings_blockers text,
  findings_notes text,
  outcome public.test_outcome,
  carry_reason public.carry_reason,
  carry_note text,
  carried_from_test_id uuid references public.sprint_tests (id),
  created_by_profile_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sprint_tests_sprint_idx on public.sprint_tests (sprint_id);
create index sprint_tests_client_idx on public.sprint_tests (client_id, created_at desc);
create trigger sprint_tests_updated_at before update on public.sprint_tests for each row execute function public.set_updated_at();
create trigger sprint_tests_client_guard before insert or update on public.sprint_tests for each row execute function public.sprint_child_client_matches();

alter table public.sprint_tests enable row level security;
create policy "sprint tests: read assigned" on public.sprint_tests for select to authenticated using (public.can_access_client(client_id));
create policy "sprint tests: team creates" on public.sprint_tests for insert to authenticated with check (public.can_access_client(client_id));
create policy "sprint tests: team updates" on public.sprint_tests for update to authenticated using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));

-- The write log now records a second kind of Notion write: a test brief.
alter table public.notion_write_log drop constraint notion_write_log_operation_check;
alter table public.notion_write_log add constraint notion_write_log_operation_check check (operation in ('create_action', 'create_test_brief'));
alter table public.notion_write_log add column sprint_test_id uuid references public.sprint_tests (id);

-- Campaigns a client ran recently, for linking a live test to what it runs in. RLS applies.
create function public.client_campaigns(p_client uuid, p_from date)
returns table (platform public.platform, campaign_id text, campaign_name text, spend numeric, last_date date)
language sql stable as $$
  select platform, campaign_id, max(campaign_name), sum(spend), max(date)
  from public.windsor_daily_metrics
  where client_id = p_client and date >= p_from and campaign_id <> ''
  group by platform, campaign_id
  order by max(date) desc, sum(spend) desc;
$$;

-- Totals for a set of campaigns over a date range (a live test's results). RLS applies.
create function public.campaign_totals(p_client uuid, p_platform public.platform, p_campaign_ids text[], p_from date, p_to date)
returns table (spend numeric, impressions bigint, clicks bigint, conversions numeric, leads numeric, days integer, data_through date)
language sql stable as $$
  select coalesce(sum(spend), 0), coalesce(sum(impressions), 0)::bigint, coalesce(sum(clicks), 0)::bigint,
         coalesce(sum(conversions), 0), coalesce(sum(leads), 0), count(distinct date)::integer, max(date)
  from public.windsor_daily_metrics
  where client_id = p_client and (p_platform is null or platform = p_platform)
    and campaign_id = any (p_campaign_ids) and date between p_from and p_to;
$$;
grant execute on function public.client_campaigns(uuid, date), public.campaign_totals(uuid, public.platform, text[], date, date) to authenticated;
