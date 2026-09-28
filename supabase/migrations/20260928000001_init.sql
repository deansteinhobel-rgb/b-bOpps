-- B&B Account Ops: initial schema.
-- The client is the spine: every client-owned table carries client_id and is scoped by it in RLS.
-- RLS is on for every table. There are no DELETE policies anywhere, so nothing can be deleted
-- through the API. Server jobs (syncs, Notion write log) use the secret key, which bypasses RLS.

-- ─── Types ──────────────────────────────────────────────────────────────────
create type public.app_role as enum ('admin', 'gtm_lead', 'am', 'specialist');
create type public.team_role as enum ('gtm_lead', 'am', 'specialist');
create type public.platform as enum ('linkedin', 'google_ads', 'meta');
create type public.cadence as enum ('weekly', 'monthly');
create type public.check_status as enum ('green', 'amber', 'red', 'na');
create type public.notion_page_type as enum ('brief', 'action', 'other');

-- ─── Helpers ────────────────────────────────────────────────────────────────
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ─── People ─────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.app_role,            -- null until an admin assigns one (or an invite does)
  notion_user_id text,             -- so actions can be assigned to a real Notion person
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Who gets which role and clients when they first sign in. Filled by the seed script, so nobody
-- has to create accounts for the team: they sign in with a magic link and the invite applies.
create table public.team_invites (
  email text primary key,
  full_name text,
  role public.app_role not null,
  notion_user_id text,
  created_at timestamptz not null default now()
);

-- ─── Clients ────────────────────────────────────────────────────────────────
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  notion_client_option text not null unique, -- exact option name of the "Client" select in Notion
  currency text not null default 'USD',
  main_kpi text not null default 'cost_per_result', -- spend / (conversions + leads)
  monthly_kpi_target numeric(12, 2),
  slack_channel text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

-- Replaces clients.am/pm/specialist_profile_id from the brief: a client can have several AMs.
create table public.client_team (
  client_id uuid not null references public.clients (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role public.team_role not null,
  primary key (client_id, profile_id, role)
);
create index client_team_profile_idx on public.client_team (profile_id);

-- Team assignments waiting for the person's first sign-in (see team_invites).
create table public.client_team_invites (
  client_id uuid not null references public.clients (id) on delete cascade,
  email text not null references public.team_invites (email) on delete cascade,
  role public.team_role not null,
  primary key (client_id, email, role)
);

create table public.client_platform_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  platform public.platform not null,
  windsor_connector text not null,     -- linkedin | google_ads | facebook
  external_account_id text not null,
  account_name text,
  monthly_budget numeric(12, 2),       -- default when no client_budgets row exists for a month
  conversion_fields text[] not null default '{}', -- Windsor field IDs summed into "conversions"
  lead_fields text[] not null default '{}',       -- Windsor field IDs summed into "leads"
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_account_id)
);
create index client_platform_accounts_client_idx on public.client_platform_accounts (client_id);
create trigger client_platform_accounts_updated_at before update on public.client_platform_accounts
  for each row execute function public.set_updated_at();

-- Budgets per month (they vary: e.g. leftover quarterly budget). campaign_id '' = whole platform.
create table public.client_budgets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  platform public.platform not null,
  campaign_id text not null default '',
  month date not null check (month = date_trunc('month', month)::date),
  amount numeric(12, 2) not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  unique (client_id, platform, campaign_id, month)
);
create trigger client_budgets_updated_at before update on public.client_budgets
  for each row execute function public.set_updated_at();

-- ─── Windsor cache (the UI never calls Windsor) ─────────────────────────────
-- Unique key adds campaign_id to the brief's (account, date, ad): campaign-level rows with no ad
-- (ad_id = '') would otherwise collide across campaigns.
create table public.windsor_daily_metrics (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  platform public.platform not null,
  external_account_id text not null,
  date date not null,
  campaign_id text not null default '',
  campaign_name text,
  ad_id text not null default '',
  ad_name text,
  spend numeric(14, 4) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions numeric(14, 4) not null default 0,
  leads numeric(14, 4) not null default 0,
  raw jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  unique (platform, external_account_id, date, campaign_id, ad_id)
);
create index windsor_daily_metrics_client_date_idx on public.windsor_daily_metrics (client_id, date);

create table public.windsor_sync_runs (
  id bigint generated always as identity primary key,
  client_id uuid references public.clients (id) on delete cascade,
  kind text not null,                  -- daily | backfill
  date_from date not null,
  date_to date not null,
  rows_upserted integer,
  success boolean,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ─── Checks ─────────────────────────────────────────────────────────────────
create table public.check_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  cadence public.cadence not null,
  owner_role public.team_role not null,
  pre_loaded text,
  instructions text not null,          -- markdown
  what_to_record text,
  not_applicable_when text,
  flag_immediately_when text,
  guide text,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table public.check_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  cadence public.cadence not null,
  period_start date not null,          -- Monday (weekly) or 1st (monthly), Europe/London
  period_end date not null,
  created_at timestamptz not null default now(),
  unique (client_id, cadence, period_start)
);

create table public.check_results (
  id uuid primary key default gen_random_uuid(),
  check_run_id uuid not null references public.check_runs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  check_definition_id uuid not null references public.check_definitions (id),
  status public.check_status,          -- null = not done yet
  findings text,
  flagged_to_profile_id uuid references public.profiles (id),
  flagged_at timestamptz,
  checked_by_profile_id uuid references public.profiles (id),
  checked_at timestamptz,
  notion_action_page_id text,
  auto_data jsonb,                     -- the numbers pre-loaded for this check
  updated_at timestamptz not null default now(),
  unique (check_run_id, check_definition_id)
);
create index check_results_client_idx on public.check_results (client_id);
create trigger check_results_updated_at before update on public.check_results
  for each row execute function public.set_updated_at();

-- A result must belong to the same client as its run.
create function public.check_results_client_matches_run() returns trigger
language plpgsql as $$
begin
  if new.client_id is distinct from (select client_id from public.check_runs where id = new.check_run_id) then
    raise exception 'check_results.client_id must match its check_run';
  end if;
  return new;
end $$;
create trigger check_results_client_guard before insert or update on public.check_results
  for each row execute function public.check_results_client_matches_run();

-- ─── Notion mirror (the UI never reads Notion live) ─────────────────────────
create table public.notion_pages_mirror (
  notion_page_id text primary key,
  data_source_id text not null,
  client_id uuid references public.clients (id) on delete set null, -- null = unmapped (admin only)
  page_type public.notion_page_type not null default 'brief',
  title text,
  properties jsonb not null default '{}',
  url text,
  parent_page_id text,
  created_by_app boolean not null default false,
  in_trash boolean not null default false,
  last_edited_time timestamptz not null,
  synced_at timestamptz not null default now()
);
create index notion_pages_mirror_client_idx on public.notion_pages_mirror (client_id);

create table public.notion_sync_state (
  data_source_id text primary key,
  last_synced_at timestamptz,
  last_full_sync_at timestamptz,
  max_last_edited_time timestamptz
);

-- Every write the app makes (or would make, in dry run) to Notion.
create table public.notion_write_log (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles (id),
  client_id uuid references public.clients (id),
  check_result_id uuid references public.check_results (id),
  operation text not null check (operation in ('create_action')),
  endpoint text not null,
  payload jsonb not null,
  response jsonb,
  success boolean,
  dry_run boolean not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ─── Access helpers for RLS ─────────────────────────────────────────────────
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'gtm_lead')
  );
$$;

create function public.has_role() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role is not null);
$$;

create function public.can_access_client(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (
    select 1 from public.client_team where client_id = cid and profile_id = auth.uid()
  );
$$;

-- ─── Sign-up: domain restriction, profile creation, invites ─────────────────
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  inv public.team_invites;
begin
  if lower(new.email) not like '%@bordeauxandburgundy.co.uk' then
    raise exception 'Only @bordeauxandburgundy.co.uk accounts can sign in';
  end if;

  select * into inv from public.team_invites where email = lower(new.email);

  insert into public.profiles (id, email, full_name, role, notion_user_id)
  values (new.id, lower(new.email), inv.full_name, inv.role, inv.notion_user_id);

  insert into public.client_team (client_id, profile_id, role)
  select client_id, new.id, role from public.client_team_invites where email = lower(new.email)
  on conflict do nothing;

  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Row Level Security ─────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.team_invites enable row level security;
alter table public.clients enable row level security;
alter table public.client_team enable row level security;
alter table public.client_team_invites enable row level security;
alter table public.client_platform_accounts enable row level security;
alter table public.client_budgets enable row level security;
alter table public.windsor_daily_metrics enable row level security;
alter table public.windsor_sync_runs enable row level security;
alter table public.check_definitions enable row level security;
alter table public.check_runs enable row level security;
alter table public.check_results enable row level security;
alter table public.notion_pages_mirror enable row level security;
alter table public.notion_sync_state enable row level security;
alter table public.notion_write_log enable row level security;

-- profiles: the team can see each other (needed for owner / flag-to pickers); only admins edit.
create policy "profiles: team reads" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role());
create policy "profiles: admin updates" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "team_invites: admin all" on public.team_invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "client_team_invites: admin all" on public.client_team_invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- clients and their config: read if assigned, write if admin.
create policy "clients: read assigned" on public.clients for select to authenticated
  using (public.can_access_client(id));
create policy "clients: admin inserts" on public.clients for insert to authenticated
  with check (public.is_admin());
create policy "clients: admin updates" on public.clients for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "client_team: read assigned" on public.client_team for select to authenticated
  using (public.can_access_client(client_id));
create policy "client_team: admin inserts" on public.client_team for insert to authenticated
  with check (public.is_admin());

create policy "accounts: read assigned" on public.client_platform_accounts for select to authenticated
  using (public.can_access_client(client_id));
create policy "accounts: admin inserts" on public.client_platform_accounts for insert to authenticated
  with check (public.is_admin());
create policy "accounts: admin updates" on public.client_platform_accounts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "budgets: read assigned" on public.client_budgets for select to authenticated
  using (public.can_access_client(client_id));
create policy "budgets: admin inserts" on public.client_budgets for insert to authenticated
  with check (public.is_admin());
create policy "budgets: admin updates" on public.client_budgets for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Windsor cache: read only. Written by the sync job with the secret key.
create policy "metrics: read assigned" on public.windsor_daily_metrics for select to authenticated
  using (public.can_access_client(client_id));
create policy "windsor runs: read assigned" on public.windsor_sync_runs for select to authenticated
  using (client_id is null and public.is_admin() or public.can_access_client(client_id));

-- Checks: everyone with a role reads definitions; the team works on its clients' runs and results.
create policy "definitions: team reads" on public.check_definitions for select to authenticated
  using (public.has_role());
create policy "definitions: admin inserts" on public.check_definitions for insert to authenticated
  with check (public.is_admin());
create policy "definitions: admin updates" on public.check_definitions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "runs: read assigned" on public.check_runs for select to authenticated
  using (public.can_access_client(client_id));
create policy "runs: team creates" on public.check_runs for insert to authenticated
  with check (public.can_access_client(client_id));

create policy "results: read assigned" on public.check_results for select to authenticated
  using (public.can_access_client(client_id));
create policy "results: team creates" on public.check_results for insert to authenticated
  with check (public.can_access_client(client_id));
create policy "results: team updates" on public.check_results for update to authenticated
  using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));

-- Notion mirror: read only. Unmapped pages (client_id null) are admin-only.
create policy "mirror: read assigned" on public.notion_pages_mirror for select to authenticated
  using (case when client_id is null then public.is_admin() else public.can_access_client(client_id) end);
create policy "notion sync state: team reads" on public.notion_sync_state for select to authenticated
  using (public.has_role());

-- Write log: admins see all, others see their own. Written only by the server function.
create policy "write log: read own or admin" on public.notion_write_log for select to authenticated
  using (public.is_admin() or profile_id = auth.uid());
