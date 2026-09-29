-- Each campaign's current status in its platform (Dean, 2026-09-29: before flagging "stopped
-- spending", check whether the campaign is paused; paused ones are ignored). Refreshed daily from
-- Windsor: Google Ads campaign_status (ENABLED / PAUSED / REMOVED), LinkedIn campaign_status
-- (ACTIVE / PAUSED / ARCHIVED / COMPLETED / CANCELED), Meta campaign_effective_status.
create table public.campaign_statuses (
  client_id uuid not null references public.clients (id) on delete cascade,
  platform public.platform not null,
  external_account_id text not null,
  campaign_id text not null,
  campaign_name text,
  status text not null,
  checked_at timestamptz not null default now(),
  primary key (platform, external_account_id, campaign_id)
);
create index campaign_statuses_client_idx on public.campaign_statuses (client_id);

alter table public.campaign_statuses enable row level security;
create policy "campaign statuses: read assigned" on public.campaign_statuses for select to authenticated using (public.can_access_client(client_id));
-- Written by the sync (secret key) only. No deletes.
