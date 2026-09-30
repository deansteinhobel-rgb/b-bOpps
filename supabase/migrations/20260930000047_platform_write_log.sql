-- Negative keywords pushed to Google Ads through Windsor (Dean, 2026-09-30). The app's first write
-- to an ad platform, and the only one: `push_negative_keywords`. Like notion_write_log, every push
-- is logged here first, then sent (only when WINDSOR_WRITES_ENABLED=true and WINDSOR_DRY_RUN=false),
-- then the log gets the result. Server-written only (admin client); the client's team can read it
-- so the search terms table can show what was already added. No deletes, and nothing removes
-- negatives from Google Ads.
create table public.platform_write_log (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles (id),
  client_id uuid not null references public.clients (id),
  platform text not null check (platform in ('google_ads')),
  external_account_id text not null,
  campaign_id text not null,
  ad_group_id text,                           -- set when level = 'ad_group'
  operation text not null check (operation in ('push_negative_keywords')),
  payload jsonb not null,                     -- exactly what went to Windsor's execute_action
  response jsonb,
  success boolean,
  dry_run boolean not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index platform_write_log_campaign_idx on public.platform_write_log (client_id, platform, campaign_id);

alter table public.platform_write_log enable row level security;
create policy "platform writes: team reads" on public.platform_write_log for select to authenticated using (public.can_access_client(client_id));
