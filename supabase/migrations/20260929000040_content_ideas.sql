-- Content ideas (Dean, 2026-09-29: "we are a content first agency"): Claude reads what content ran
-- (offer type, topic, format, the creative itself), who it reached and how it performed, and suggests
-- content, ads and angles to brief in or test in a sprint. Each idea must fit the audience it's aimed
-- at. Shown on At a glance. Client-scoped; nothing is deleted (runs are archived).
create table public.content_idea_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  progress text,
  requested_by_profile_id uuid references public.profiles (id),
  model text,
  headline text,
  working jsonb not null default '[]',   -- [{ content_type, topic, format, platform, audience, campaigns[], spend, results, cpr, ctr, verdict, why }]
  ideas jsonb not null default '[]',     -- [{ id, title, kind, content_type, topic, platform, format, audience, audience_basis, built_on[], evidence, why_it_fits, hook, success, impact, confidence, effort }]
  avoid jsonb not null default '[]',     -- [{ what, why }]
  usage jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  archived_at timestamptz
);
create index content_idea_runs_client_idx on public.content_idea_runs (client_id, created_at desc);

alter table public.content_idea_runs enable row level security;
create policy "content idea runs: read assigned" on public.content_idea_runs for select to authenticated using (public.can_access_client(client_id));
-- Written by the server job (secret key) after the request was authorised.

-- What the team did with each idea: planned as a sprint test, or not for us (with a reason Claude reads next time). Append-only.
create table public.content_idea_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  run_id uuid not null references public.content_idea_runs (id) on delete cascade,
  idea_id text not null,
  action text not null check (action in ('planned', 'dismissed', 'reopened')),
  reason text check (length(reason) <= 500),
  sprint_test_id uuid references public.sprint_tests (id),
  snapshot jsonb,
  profile_id uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index content_idea_actions_client_idx on public.content_idea_actions (client_id, created_at desc);

alter table public.content_idea_actions enable row level security;
create policy "content idea actions: read assigned" on public.content_idea_actions for select to authenticated using (public.can_access_client(client_id));
create policy "content idea actions: team logs" on public.content_idea_actions for insert to authenticated with check (public.can_edit_client(client_id) and profile_id = (select auth.uid()));
-- No update or delete policies.

-- Tests planned from a content idea carry its id (a "Content idea" tag on the board, kept on carry-over).
alter table public.sprint_tests add column content_idea_id text;
