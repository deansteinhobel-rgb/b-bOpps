-- The campaign builder, phase B (Dean, 2026-10-21): LinkedIn first. Additive only.
--
--   ad_playbooks            best practice research per platform, refreshed monthly by Claude with web
--                           search (official docs, trade press, Reddit threads, LinkedIn posts). Public
--                           information, not client data, so it isn't client-scoped (like news_answers).
--   ad_playbook_rules       the team's own playbook: guardrails (checked on every save and send), house
--                           practices Claude follows, and naming rules. For every client (client_id null,
--                           admins edit) or one client (its team edits). Soft-removed, never deleted.
--   ad_naming_conventions   the naming pattern Claude reads from each client's live campaign names.
--   campaign_build_plans    one planning run: the request, what Claude asked, the answers and its plan.
-- Plus: campaign_builds.plan_id / mode, live-campaign edits in platform_write_log (with the value
-- before), and a private bucket for ad images.

create table public.ad_playbooks (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('linkedin', 'google_ads', 'meta', 'reddit')),
  period text not null,                         -- YYYY-MM the research is for
  status text not null default 'running' check (status in ('running', 'ready', 'failed')),
  summary text,
  sections jsonb not null default '[]',         -- [{ heading, points: [{ text, sources: [n], strength }] }]
  sources jsonb not null default '[]',          -- [{ n, title, url, kind }]
  model text,
  usage jsonb,
  error text,
  requested_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index ad_playbooks_platform_idx on public.ad_playbooks (platform, created_at desc);
alter table public.ad_playbooks enable row level security;
create policy "playbooks: anyone with a role reads" on public.ad_playbooks for select to authenticated using (public.has_role());

create table public.ad_playbook_rules (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('linkedin', 'google_ads', 'meta', 'reddit')),
  client_id uuid references public.clients (id),        -- null = every client
  kind text not null check (kind in ('guardrail', 'practice', 'naming')),
  modes text[] not null default '{general,abx}',         -- which builder views it applies to
  title text not null check (length(title) between 1 and 200),
  body text not null default '' check (length(body) <= 2000),
  -- A guardrail the app checks itself: { field, op: max | min | forbid | require, value }.
  check_rule jsonb,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id)
);
create index ad_playbook_rules_idx on public.ad_playbook_rules (platform, client_id) where removed_at is null;
alter table public.ad_playbook_rules enable row level security;
create policy "playbook rules: read" on public.ad_playbook_rules for select to authenticated
  using (case when client_id is null then public.has_role() else public.can_access_client(client_id) end);
create policy "playbook rules: add" on public.ad_playbook_rules for insert to authenticated
  with check (case when client_id is null then public.is_admin() else public.can_edit_client(client_id) end);
create policy "playbook rules: edit" on public.ad_playbook_rules for update to authenticated
  using (case when client_id is null then public.is_admin() else public.can_edit_client(client_id) end)
  with check (case when client_id is null then public.is_admin() else public.can_edit_client(client_id) end);

create table public.ad_naming_conventions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  platform text not null check (platform in ('linkedin', 'google_ads', 'meta', 'reddit')),
  names_digest text not null,                   -- of the names it read, so it's only redone when they change
  pattern text not null,                        -- e.g. "{program} | {audience} | {topic} | {format} | {objective}"
  parts jsonb not null default '[]',            -- [{ key, meaning, values: [] }]
  separator text,
  examples text[] not null default '{}',
  notes text,
  model text,
  usage jsonb,
  created_at timestamptz not null default now()
);
create index ad_naming_conventions_idx on public.ad_naming_conventions (client_id, platform, created_at desc);
alter table public.ad_naming_conventions enable row level security;
create policy "naming conventions: team reads" on public.ad_naming_conventions for select to authenticated using (public.can_access_client(client_id));

create table public.campaign_build_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  platform text not null check (platform in ('linkedin', 'reddit')),
  mode text not null default 'general' check (mode in ('general', 'abx')),
  preset text not null,
  request text not null default '',
  proposal text,                                -- pasted proposal or brief, if any
  sprint_test_id uuid references public.sprint_tests (id),
  answers jsonb not null default '{}',          -- question id → answer
  status text not null default 'planning' check (status in ('planning', 'questions', 'ready', 'failed')),
  questions jsonb not null default '[]',        -- only what Claude couldn't find: [{ id, question, why, options }]
  plan jsonb,                                   -- Claude's plan (see src/lib/campaign-builder/plan-schema.ts)
  model text,
  usage jsonb,
  error text,
  campaign_build_id uuid references public.campaign_builds (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaign_build_plans_client_idx on public.campaign_build_plans (client_id, created_at desc);
alter table public.campaign_build_plans enable row level security;
create policy "build plans: team reads" on public.campaign_build_plans for select to authenticated using (public.can_access_client(client_id));

alter table public.campaign_builds
  add column plan_id uuid references public.campaign_build_plans (id),
  add column mode text not null default 'general' check (mode in ('general', 'abx'));

-- Edits to live LinkedIn campaigns (Dean, 2026-10-21): pause, daily budget, end date, name. Each one
-- logs the value before it as read from the platform. There is still no enable, remove or delete.
alter table public.platform_write_log drop constraint platform_write_log_operation_check;
alter table public.platform_write_log add constraint platform_write_log_operation_check
  check (operation in (
    'push_negative_keywords', 'create_responsive_search_ad', 'pause_ad',
    'create_campaign_group', 'create_campaign', 'create_ad_group', 'upload_image', 'create_post', 'create_ad',
    'pause_campaign', 'update_campaign'
  ));
alter table public.platform_write_log add column previous jsonb;

-- Ad images for builds: private, read and written by the server only (after an access check),
-- at <client_id>/<uuid>.<ext>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-assets', 'campaign-assets', false, 5242880, array['image/jpeg', 'image/png', 'image/gif'])
on conflict (id) do nothing;

-- A starting playbook for LinkedIn, every client, from what the app already treats as rules (Audience
-- Network spend is an urgent settings check). The team edits and adds to it on the builder.
insert into public.ad_playbook_rules (platform, kind, title, body, check_rule) values
  ('linkedin', 'guardrail', 'Audience Network off', 'Audience Network spend is flagged as urgent in Recommendations. Keep it off on every build.', '{"field": "audienceNetwork", "op": "forbid"}'),
  ('linkedin', 'practice', 'Audience expansion off', 'Lumaux can''t read audience expansion back, so leave it off and say so in the plan.', null),
  ('linkedin', 'practice', 'One variable per campaign', '3-4 ads per campaign, testing one thing (hook, visual, offer or format) so the result means something.', null),
  ('linkedin', 'practice', 'Read the client''s own numbers first', 'Base bids, budgets and audiences on what has worked for this client (cost per result by campaign, audience and format) before general benchmarks.', null),
  ('linkedin', 'guardrail', 'Headlines that fit', 'LinkedIn cuts headlines over 70 characters on some screens.', '{"field": "headlineLength", "op": "max", "value": 70}');

do $$
declare
  t text;
begin
  foreach t in array array['ad_playbook_rules', 'campaign_build_plans'] loop
    execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function public.log_change()', t);
  end loop;
end
$$;
