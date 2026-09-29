-- Performance phase 4: "Ask about this campaign" on the campaign drill-down. The weekly trend read
-- (the first suggested question) is answered once per campaign per week and shared by the client's
-- team, like the news cellar's cache. Free-form questions aren't stored. No deletes.
create table public.campaign_reads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  platform public.platform not null,
  campaign_id text not null,
  week date not null,                 -- Monday of the week the data runs to
  answer text not null,
  sources jsonb not null default '[]',
  model text,
  usage jsonb,
  created_at timestamptz not null default now(),
  unique (client_id, platform, campaign_id, week)
);
alter table public.campaign_reads enable row level security;
create policy "campaign reads: read assigned" on public.campaign_reads for select to authenticated using (public.can_access_client(client_id));
-- Written by the server (secret key) after checking the user can see the client. No deletes.
