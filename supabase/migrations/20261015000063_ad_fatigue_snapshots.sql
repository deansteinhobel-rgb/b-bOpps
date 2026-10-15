-- Live ads and ad fatigue, worked out once a day (Dean, 2026-10-15: "once a day for live ads and ad fatigue is
-- enough"). The daily Windsor sync stores each client's ad_fatigue_inputs rows here right after it finishes, and
-- every page reads the latest copy instead of working it out again. A client with no copy from the last 36 hours
-- (new, or the sync failed) is worked out live as before.
-- One row per client per day: server-written (admin client), re-running the same day replaces that day's copy.
-- The client's team reads. No deletes.
create table public.ad_fatigue_snapshots (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id),
  snapshot_on date not null,          -- the day it was taken (Europe/London)
  data_through date,                  -- the latest synced day it covers
  ad_count int not null,
  rows jsonb not null default '[]',   -- ad_fatigue_inputs(client_id), as returned
  created_at timestamptz not null default now(),
  unique (client_id, snapshot_on)
);

alter table public.ad_fatigue_snapshots enable row level security;
create policy "ad fatigue snapshots: team reads" on public.ad_fatigue_snapshots for select to authenticated using (public.can_access_client(client_id));
