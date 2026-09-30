-- Client call notes (Dean, 2026-09-30): each client's call notes in Notion (read only, never
-- written) are read as soon as they land, plus the history. Claude summarises each call and pulls
-- out what we said we'd try, stop or change. The summaries feed the Client brain, and anything said
-- on a call that shows no sign of happening in the app or Notion a week later pops up as a reminder
-- for the client's team. Client-scoped; nothing is deleted.

-- Where each client's call notes live: a Notion database (one row per call) or a page (one sub-page
-- per call, or a database on it). Linked on the Brain tab by GTM leads and admins.
alter table public.clients
  add column call_notes_notion_id text,
  add column call_notes_kind text check (call_notes_kind in ('page', 'database')),
  add column call_notes_checked_at timestamptz,      -- last read of the source
  add column call_followups_checked_at timestamptz;  -- last "has it happened?" check

create table public.client_calls (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  source text not null check (source in ('notion', 'manual')),
  notion_page_id text,
  title text not null,
  call_date date not null,
  notion_status text,                -- e.g. "Call Notes Complete"
  content text,                      -- the notes as text
  content_chars int,
  content_digest text,               -- re-extract only when the text changed
  last_edited_time timestamptz,
  synced_at timestamptz,
  summary text,                      -- Claude's summary
  extract_status text not null default 'pending' check (extract_status in ('pending', 'done', 'failed', 'skipped')),
  extracted_at timestamptz,
  extract_error text,
  usage jsonb,
  created_by_profile_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index client_calls_notion_idx on public.client_calls (client_id, notion_page_id) where source = 'notion';
create index client_calls_client_idx on public.client_calls (client_id, call_date desc);

-- What was said on a call that someone should act on: try, stop, change, an idea, a follow-up.
-- Written by the server (Claude's extraction and the daily follow-up check).
create table public.call_commitments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  call_id uuid not null references public.client_calls (id) on delete cascade,
  kind text not null check (kind in ('try', 'stop', 'change', 'idea', 'follow_up')),
  title text not null,               -- "Try Thought Leader ads on LinkedIn"
  detail text,
  quote text,                        -- the words in the notes
  platform text,
  owner_side text not null default 'bb' check (owner_side in ('bb', 'client', 'both')),
  owner_name text,
  due_on date,
  said_on date not null,
  -- The follow-up check: when we last looked, and what showed it happened.
  checked_at timestamptz,
  acted_at timestamptz,
  acted_evidence text,
  acted_href text,
  reminded_at timestamptz,           -- first time it became a reminder (Slack, once it's set up)
  superseded_at timestamptz,         -- the notes were edited and it's no longer in them
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index call_commitments_client_idx on public.call_commitments (client_id, said_on desc);
create index call_commitments_call_idx on public.call_commitments (call_id);

-- What the team did about one: done, not doing it (with a reason), snoozed, planned as a sprint
-- test, reopened. Append-only; the latest one wins.
create table public.call_commitment_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  commitment_id uuid not null references public.call_commitments (id) on delete cascade,
  action text not null check (action in ('done', 'dropped', 'snoozed', 'planned', 'reopened')),
  reason text check (length(reason) <= 500),
  snooze_until date,
  sprint_test_id uuid references public.sprint_tests (id),
  profile_id uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index call_commitment_actions_idx on public.call_commitment_actions (commitment_id, created_at desc);
create index call_commitment_actions_client_idx on public.call_commitment_actions (client_id);

alter table public.client_calls enable row level security;
alter table public.call_commitments enable row level security;
alter table public.call_commitment_actions enable row level security;

create policy "calls: read assigned" on public.client_calls for select to authenticated using (public.can_access_client(client_id));
create policy "commitments: read assigned" on public.call_commitments for select to authenticated using (public.can_access_client(client_id));
create policy "commitment actions: read assigned" on public.call_commitment_actions for select to authenticated using (public.can_access_client(client_id));
create policy "commitment actions: team logs" on public.call_commitment_actions for insert to authenticated
  with check (public.can_edit_client(client_id) and profile_id = (select auth.uid()));
-- Calls and commitments are written by the server (secret key) after an access check. No update or
-- delete policies anywhere.

-- Tests planned from something said on a call (a "From a call" tag, kept on carry-over).
alter table public.sprint_tests add column call_commitment_id uuid references public.call_commitments (id);

-- Read new call notes every hour (Supabase Cron, like notion-sync-hourly). Read only towards Notion.
select cron.schedule(
  'call-notes-hourly',
  '35 * * * *',
  $$
  select net.http_get(
    url := 'https://bbmopsapp.vercel.app/api/cron/calls',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    timeout_milliseconds := 60000
  );
  $$
);
