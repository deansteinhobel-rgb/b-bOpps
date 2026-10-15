-- Content Bank as a Client brain source (Dean, 2026-10-15). The Notion "Content Bank" database
-- (one row per content piece, transcript or source note, told apart by a free-text Client field)
-- is read, never written, into client_knowledge. Rows stay source = 'notion' (they are Notion
-- pages); notion_collection says which collection they came from. Null = the client's GTM HQ.
-- Additive only.

alter table public.client_knowledge
  add column notion_collection text check (notion_collection in ('content_bank'));

comment on column public.client_knowledge.notion_collection is
  'Where a Notion source came from: null = the client''s GTM HQ, content_bank = a row of the shared Content Bank whose Client matches this client.';
