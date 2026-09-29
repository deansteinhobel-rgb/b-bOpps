-- Performance phase 4 (Dean, 2026-09-29): Claude on top of the "Optimise now" rules. Once a day per
-- client (and on demand for GTM leads / admins) Claude reads the feed, the client brief, the campaign
-- names and their Notion briefs, and writes:
--   headline / start_here   a short read of the feed and the 1-3 things to do first
--   ranking                 its order for the open insights, each with a "why now" line
--   companies               LinkedIn companies that clicked, judged against the ICP
--   terms                   costly search terms with no conversions, judged against the ICP
--   goals                   each campaign's goal, from its name, its Notion briefs and the client brief
-- The rules read companies / terms / goals as inputs. No deletes; old reviews are kept.
create table public.insight_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  requested_by_profile_id uuid references public.profiles (id),
  model text,
  headline text,
  start_here jsonb not null default '[]',   -- [{ key, why }]
  ranking jsonb not null default '[]',      -- [{ key, why_now }] in Claude's order
  companies jsonb not null default '[]',    -- [{ name, fit: icp | not_icp | unsure, reason }]
  terms jsonb not null default '[]',        -- [{ campaign_id, term, fit: relevant | clash | unsure, reason }]
  goals jsonb not null default '[]',        -- [{ platform, campaign_id, goal, note }]
  usage jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index insight_reviews_client_idx on public.insight_reviews (client_id, created_at desc);

alter table public.insight_reviews enable row level security;
create policy "insight reviews: read assigned" on public.insight_reviews for select to authenticated using (public.can_access_client(client_id));
-- Written by the server job (secret key) after the request was authorised. No deletes.

-- A finished review changes the feed (ICP verdicts, campaign goals), so it's part of the data stamp.
create or replace function public.client_data_stamp(p_client uuid)
returns text
language sql stable as $$
  select coalesce(greatest(
    (select max(coalesce(finished_at, started_at)) from public.windsor_sync_runs where client_id = p_client),
    (select max(synced_at) from public.breakdown_sync_state where client_id = p_client),
    (select max(checked_at) from public.campaign_statuses where client_id = p_client),
    (select max(finished_at) from public.insight_reviews where client_id = p_client and status = 'ready')
  )::text, 'none');
$$;
