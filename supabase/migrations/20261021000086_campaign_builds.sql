-- Campaigns built from Lumaux through the platforms' own APIs (Dean, 2026-10-21): LinkedIn and Reddit
-- first, Microsoft Ads once its reporting is in. Everything is created PAUSED; a person turns it on
-- in the platform. Nothing enables, edits a live campaign, removes or deletes. Additive only.
--
-- A build is one plan (campaign, audience, ads) made of several API calls. Each call is one
-- platform_write_log row, written before the call is sent (no log, no write), keyed so a retry
-- picks up after the last step that worked instead of creating duplicates.

create table public.campaign_builds (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  platform text not null check (platform in ('linkedin', 'reddit')),
  external_account_id text not null,
  sprint_test_id uuid references public.sprint_tests (id),
  name text not null,
  spec jsonb not null,                        -- the whole plan, validated on the server before every run
  status text not null default 'draft' check (status in ('draft', 'sending', 'created', 'partly_created', 'failed')),
  created_ids jsonb not null default '{}',    -- step key → the id the platform returned (live runs only)
  error text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dry_run_at timestamptz,                     -- last dry run (dry runs never change status or created_ids)
  sent_at timestamptz,
  completed_at timestamptz
);
create index campaign_builds_client_idx on public.campaign_builds (client_id, created_at desc);
create index campaign_builds_test_idx on public.campaign_builds (sprint_test_id) where sprint_test_id is not null;

-- Server-written only (admin client, after the app's own checks); the client's team reads.
alter table public.campaign_builds enable row level security;
create policy "campaign builds: team reads" on public.campaign_builds for select to authenticated using (public.can_access_client(client_id));

-- The write log takes the new platforms and operations. campaign_id is empty for calls that come
-- before a campaign exists (a campaign group, an image, a post).
alter table public.platform_write_log drop constraint platform_write_log_platform_check;
alter table public.platform_write_log add constraint platform_write_log_platform_check
  check (platform in ('google_ads', 'linkedin', 'reddit'));
alter table public.platform_write_log drop constraint platform_write_log_operation_check;
alter table public.platform_write_log add constraint platform_write_log_operation_check
  check (operation in (
    'push_negative_keywords', 'create_responsive_search_ad', 'pause_ad',
    'create_campaign_group', 'create_campaign', 'create_ad_group', 'upload_image', 'create_post', 'create_ad'
  ));
alter table public.platform_write_log alter column campaign_id drop not null;
alter table public.platform_write_log
  add column campaign_build_id uuid references public.campaign_builds (id),
  add column step text;                       -- the build step this call was (e.g. 'campaign', 'ad:0')
create index platform_write_log_build_idx on public.platform_write_log (campaign_build_id) where campaign_build_id is not null;

-- OAuth refresh tokens for the ad platform APIs live in Supabase Vault (Microsoft hands out a new
-- one every time and each lasts 90 days, so a fixed environment variable would stop working).
-- Only the server (service_role) can read or store them.
create function public.ads_api_token(p_platform text) returns text
language sql security definer set search_path = '' stable as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ads_refresh_' || p_platform
$$;

create function public.set_ads_api_token(p_platform text, p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  existing uuid;
begin
  if p_platform not in ('linkedin', 'reddit', 'microsoft_ads') then
    raise exception 'unknown platform %', p_platform;
  end if;
  select id into existing from vault.secrets where name = 'ads_refresh_' || p_platform;
  if existing is null then
    perform vault.create_secret(p_token, 'ads_refresh_' || p_platform, 'Lumaux ad platform API refresh token');
  else
    perform vault.update_secret(existing, p_token);
  end if;
end
$$;

revoke all on function public.ads_api_token(text) from public, anon, authenticated;
revoke all on function public.set_ads_api_token(text, text) from public, anon, authenticated;
grant execute on function public.ads_api_token(text) to service_role;
grant execute on function public.set_ads_api_token(text, text) to service_role;

-- When each connection was made and when it runs out (LinkedIn refresh tokens last a year), so
-- Admin can warn ahead of time. No secrets here. Server-written; admins read.
create table public.ads_api_connections (
  platform text primary key check (platform in ('linkedin', 'reddit', 'microsoft_ads')),
  connected_at timestamptz not null,
  refresh_expires_at timestamptz,
  last_refreshed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.ads_api_connections enable row level security;
create policy "ads api connections: admins read" on public.ads_api_connections for select to authenticated using (public.is_admin());
