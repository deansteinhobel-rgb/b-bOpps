-- "Check against the ICP" on a Google campaign's search terms (Dean, 2026-09-30): Claude's verdicts
-- on which terms to exclude or watch, shorter negatives that block a whole off-ICP theme (checked by
-- the app against the terms that converted), and keywords worth pausing. Suggestions only. One row
-- per check, server-written (admin client); the client's team reads. No deletes.
create table public.term_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  platform text not null check (platform in ('google_ads')),
  campaign_id text not null,
  from_date date not null,
  to_date date not null,
  terms_sent int not null,
  headline text not null,
  points jsonb not null default '[]',
  terms jsonb not null default '[]',      -- [{ term, verdict: exclude|watch, reason }]
  roots jsonb not null default '[]',      -- [{ text, matchType, reason, blocked, blockedSpend, unsafe }]
  keywords jsonb not null default '[]',   -- [{ keyword, verdict: pause|review, reason }]
  model text not null,
  usage jsonb,
  requested_by_profile_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index term_reviews_campaign_idx on public.term_reviews (client_id, platform, campaign_id, created_at desc);

alter table public.term_reviews enable row level security;
create policy "term reviews: team reads" on public.term_reviews for select to authenticated using (public.can_access_client(client_id));
