-- Platform settings checks (Dean, 2026-10-15): niche delivery settings read from Windsor per campaign
-- (Google, LinkedIn) or ad set (Meta), so Optimize now can flag the risky ones as urgent.
-- Server-written (the daily settings sync), team reads. Rows are replaced on each check, never deleted:
-- a campaign that stops running keeps its last row, and the rules only read rows from the latest check.
create table public.platform_settings (
  client_id uuid not null references public.clients (id),
  platform text not null check (platform in ('google_ads', 'linkedin', 'meta')),
  external_account_id text not null,
  level text not null check (level in ('campaign', 'adset')),
  entity_id text not null,
  entity_name text,
  campaign_id text not null,
  campaign_name text,
  -- Google: geo_target_type, channel_type, search_partners, display_network, ai_max.
  -- LinkedIn: audience_network_spend (last 3 days, from delivery: Windsor has no setting field).
  -- Meta: advantage_audience, matched_audiences, location_types, audience_network_spend (last 3 days).
  settings jsonb not null default '{}',
  checked_at timestamptz not null default now(),
  primary key (platform, external_account_id, level, entity_id)
);
create index platform_settings_client_idx on public.platform_settings (client_id, checked_at desc);

alter table public.platform_settings enable row level security;
create policy "platform settings: read assigned" on public.platform_settings for select to authenticated
  using (client_id in (select public.my_client_ids()));

-- A new settings check is part of the data stamp, so the cached Optimize now feed refreshes.
create or replace function public.client_data_stamp(p_client uuid)
returns text
language sql stable as $$
  select coalesce(greatest(
    (select max(coalesce(finished_at, started_at)) from public.windsor_sync_runs where client_id = p_client),
    (select max(synced_at) from public.breakdown_sync_state where client_id = p_client),
    (select max(checked_at) from public.campaign_statuses where client_id = p_client),
    (select max(finished_at) from public.insight_reviews where client_id = p_client and status = 'ready'),
    (select max(checked_at) from public.platform_settings where client_id = p_client)
  )::text, 'none');
$$;
