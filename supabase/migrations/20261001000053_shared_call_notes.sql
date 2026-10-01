-- Shared call note databases (Dean, 2026-10-01): one Notion database can hold several clients'
-- calls ("Client Meetings, Calls & Reports | EMEA" for Proactis and Star; a US one is on its way),
-- told apart by a Client select. Each client keeps its own link, plus the option its rows carry.
-- Still read only; additive.
alter table public.clients
  add column call_notes_client_option text, -- the Client option to read, e.g. "Star"; null = every row is this client's
  add column call_notes_title text;         -- the source's title, for the Brain tab
