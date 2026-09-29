-- The Client brain (Dean, 2026-09-29): everything we know about a client, fed to Claude.
-- Sources are the client's GTM HQ pages in B&B's Notion (read only, never written), team notes
-- and uploaded files. Claude condenses them into a versioned client brief that "Pour me a sprint"
-- reads. Everything is client-scoped. No deletes: notes and files are soft-removed.

alter table public.clients add column notion_hq_page_id text;

create table public.client_knowledge (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  source text not null check (source in ('notion', 'note', 'file')),
  -- Notion HQ pages and databases
  notion_page_id text,
  notion_kind text check (notion_kind in ('page', 'database')),
  path text,                         -- where it sits in the HQ, e.g. "Raymond › Planning"
  include boolean not null default false,
  last_edited_time timestamptz,
  -- Team notes: short must-knows
  category text check (category in ('target', 'constraint', 'note')),
  -- Uploaded files (private "client-files" bucket)
  file_path text,
  file_type text,
  title text not null,
  content text,                      -- extracted text (Notion) or the note itself
  content_chars int,
  synced_at timestamptz,
  error text,
  created_by_profile_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index client_knowledge_notion_idx on public.client_knowledge (client_id, notion_page_id) where source = 'notion';
create index client_knowledge_client_idx on public.client_knowledge (client_id, source);

create table public.client_briefs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  status text not null default 'ready' check (status in ('generating', 'ready', 'failed')),
  content text,                      -- markdown, fixed headings
  written_by text not null default 'claude' check (written_by in ('claude', 'person')),
  source_digest text,                -- hash of the sources it was built from
  source_count int,
  model text,
  usage jsonb,
  error text,
  created_by_profile_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index client_briefs_client_idx on public.client_briefs (client_id, created_at desc);

alter table public.client_knowledge enable row level security;
alter table public.client_briefs enable row level security;

-- The client's team reads everything, adds and edits notes, and can correct the brief (a new
-- version). Which HQ pages count, syncing and Claude's rebuilds go through the server.
create policy "knowledge: read assigned" on public.client_knowledge for select to authenticated using (public.can_access_client(client_id));
create policy "knowledge: team adds notes" on public.client_knowledge for insert to authenticated with check (public.can_access_client(client_id) and source = 'note');
create policy "knowledge: team edits notes" on public.client_knowledge for update to authenticated using (public.can_access_client(client_id) and source = 'note') with check (public.can_access_client(client_id) and source = 'note');
create policy "briefs: read assigned" on public.client_briefs for select to authenticated using (public.can_access_client(client_id));
create policy "briefs: team corrects" on public.client_briefs for insert to authenticated with check (public.can_access_client(client_id) and written_by = 'person');

-- Uploaded files: private, read and written by the server only (after an access check).
insert into storage.buckets (id, name, public, file_size_limit)
values ('client-files', 'client-files', false, 10485760)
on conflict (id) do nothing;
