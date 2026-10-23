-- Generate a campaign brief, files (Dean, 2026-10-23: "attach a file for context or even just to
-- check what we can change"). A brief can carry up to three files from the private client-files
-- bucket (the client's own folder, uploaded through a signed link after an access check), and runs in
-- one of two modes: 'new' writes a brief, 'review' reads the attached plan and says what to change.

alter table public.campaign_briefs
  add column mode text not null default 'new' check (mode in ('new', 'review')),
  add column attachments jsonb not null default '[]';   -- [{ path, name, type, size }]
