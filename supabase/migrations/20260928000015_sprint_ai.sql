-- "Pour me a sprint": Claude suggests tests for a client's sprint from Windsor history, past tests
-- and paid media news. Suggestions are reviewed, then approved (turning into a planned test) or
-- rejected with a reason. GTM leads and admins only (is_admin() covers both). No deletes.

create table public.sprint_ai_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  sprint_id uuid not null references public.sprints (id) on delete cascade,
  requested_by_profile_id uuid references public.profiles (id),
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  stage text not null default 'queued',      -- queued | reading | researching | drafting | done
  stage_note text,                           -- e.g. the search Claude is running
  progress numeric(4, 3) not null default 0, -- 0..1, fills the wine glass
  market_summary text,                       -- what's happening in paid media, in a few lines
  news jsonb not null default '[]',          -- [{ platform, headline, detail, date, url }]
  model text,
  usage jsonb,                               -- tokens and web searches, for cost tracking
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index sprint_ai_runs_client_idx on public.sprint_ai_runs (client_id, created_at desc);

create table public.sprint_recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.sprint_ai_runs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  sprint_id uuid not null references public.sprints (id) on delete cascade,
  position int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'approved', 'rejected')),
  -- Any platform can be suggested (Reddit, Bing, X, ChatGPT Ads...), connected or not.
  platform text not null,
  title text not null,
  hypothesis text,
  assets text[] not null default '{}',
  brief_notes text,
  success_metric text,
  success_target numeric(14, 4),
  success_text text,
  why_data text,                             -- what in our numbers / past tests points here
  why_market text,                           -- the trend or platform news behind it, if any
  sources jsonb not null default '[]',       -- [{ title, url }]
  confidence text check (confidence in ('low', 'medium', 'high')),
  effort text check (effort in ('low', 'medium', 'high')),
  reviewed_by_profile_id uuid references public.profiles (id),
  reviewed_at timestamptz,
  decided_by_profile_id uuid references public.profiles (id),
  decided_at timestamptz,
  reject_reason text,
  sprint_test_id uuid references public.sprint_tests (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sprint_recommendations_run_idx on public.sprint_recommendations (run_id, position);
create index sprint_recommendations_client_idx on public.sprint_recommendations (client_id, status);

alter table public.sprint_ai_runs enable row level security;
alter table public.sprint_recommendations enable row level security;

-- The client's team can see suggestions; only GTM leads and admins create, review and decide.
create policy "ai runs: read assigned" on public.sprint_ai_runs for select to authenticated using (public.can_access_client(client_id));
create policy "ai runs: admins create" on public.sprint_ai_runs for insert to authenticated with check (public.is_admin());
create policy "recommendations: read assigned" on public.sprint_recommendations for select to authenticated using (public.can_access_client(client_id));
create policy "recommendations: admins update" on public.sprint_recommendations for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- Run progress and the suggestions themselves are written by the server job (secret key), after
-- the request was authorised as a GTM lead or admin.
