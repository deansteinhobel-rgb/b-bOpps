-- Platform change history for the Account tab (Dean, 2026-09-29): what changed in each ad account,
-- by whom, from the platforms themselves.
--   Google Ads  change history (Windsor change_event_*): who, when, what, how (web, Editor, API...)
--   Meta        activity log (Windsor activity_*), billing events left out
--   LinkedIn    has no change log in its API: edited ads (creative last-modified time) and campaign
--               status changes we detect on the daily sync
-- Stored GROUPED: Google can log tens of thousands of changes a day (e.g. an IP-exclusion tool), so
-- one row is one kind of change by one person in one hour, with a count and the campaigns it touched.
-- Written by the sync (secret key) only; the client's team reads. No deletes.
create table public.platform_changes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  platform public.platform not null,
  external_account_id text not null,
  changed_at timestamptz not null,
  actor text,                          -- email or name when the platform says; null for detected changes
  via text,                            -- "Google Ads (web)", "Google Ads Editor", "API or tool", "Detected"...
  object_type text not null,           -- "Campaign", "Budget", "IP exclusion", "Ad", "Keyword"...
  operation text not null,             -- added | changed | removed | other
  campaign_id text,                    -- when the change touched one campaign
  campaign_name text,
  object_name text,
  summary text not null,               -- one line, plain English
  detail text,                         -- what changed (fields, old -> new) when known
  change_count int not null default 1,
  campaigns text[] not null default '{}',
  bulk boolean not null default false, -- many changes at once (usually a tool or bulk upload)
  change_key text not null,
  synced_at timestamptz not null default now(),
  unique (client_id, platform, change_key)
);
create index platform_changes_client_idx on public.platform_changes (client_id, changed_at desc);

alter table public.platform_changes enable row level security;
create policy "platform changes: read assigned" on public.platform_changes for select to authenticated using (public.can_access_client(client_id));

-- LinkedIn edited-ad detection needs each creative's last-modified time from the previous sync.
create table public.creative_modified_state (
  client_id uuid not null references public.clients (id) on delete cascade,
  external_account_id text not null,
  creative_id text not null,
  campaign_id text,
  last_modified timestamptz,
  checked_at timestamptz not null default now(),
  primary key (external_account_id, creative_id)
);
alter table public.creative_modified_state enable row level security;
-- Server only (no policies).
