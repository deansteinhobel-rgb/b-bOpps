-- Planning › Generate a campaign brief (Dean, 2026-10-23). Someone asks for a campaign ("an MSP
-- campaign for DNSFilter"), Claude asks what it needs to know in a pop-up, then writes the brief from
-- everything Lumaux knows about the client: ad types and quantities per platform, A/B tests, assets,
-- budget, KPIs. The brief can go to Master Production as one new page, or be exported as Word.
--
-- Written by the server only (secret key, after an access check); the team reads through RLS. No
-- deletes: a brief is archived.

create table public.campaign_briefs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  request text not null check (length(request) between 1 and 4000),
  notes text check (length(notes) <= 20000),        -- anything pasted alongside (a proposal, call notes)
  status text not null default 'asking' check (status in ('asking', 'questions', 'writing', 'ready', 'failed')),
  questions jsonb not null default '[]',            -- [{ id, question, why, options }]
  answers jsonb not null default '{}',              -- question id → answer
  brief jsonb,                                      -- src/lib/campaign-brief/schema.ts
  revision text check (length(revision) <= 4000),   -- the last change someone asked for
  model text,
  usage jsonb,
  error text,
  notion_page_id text,
  notion_page_url text,
  notion_sent_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles (id)
);
create index campaign_briefs_client_idx on public.campaign_briefs (client_id, created_at desc);
alter table public.campaign_briefs enable row level security;
create policy "campaign briefs: team reads" on public.campaign_briefs for select to authenticated using (public.can_access_client(client_id));

-- Notion: a fourth kind of Master Production page, the campaign brief. Still create-only through
-- createNotionAction, one live page per brief (brief_key 'campaign:<brief id>').
alter table public.notion_write_log drop constraint notion_write_log_operation_check;
alter table public.notion_write_log add constraint notion_write_log_operation_check
  check (operation in ('create_action', 'create_test_brief', 'create_comment', 'create_sequence_brief', 'create_campaign_brief'));
alter table public.notion_write_log add column campaign_brief_id uuid references public.campaign_briefs (id);
alter table public.notion_write_log add constraint notion_write_log_campaign_brief_keyed
  check (operation <> 'create_campaign_brief' or (campaign_brief_id is not null and brief_key is not null));
create unique index notion_write_log_one_campaign_brief on public.notion_write_log (brief_key)
  where operation = 'create_campaign_brief' and not dry_run and success is not false;
