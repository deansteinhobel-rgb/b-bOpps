-- "Pour me a sprint" runs can be archived (Dean, 2026-09-29: clear DNSFilter's suggestions to test
-- the module again). Nothing is deleted: an archived run and its suggestions stay in the database but
-- are hidden on the Sprint tab and left out of what Claude reads next time. Clearing archived_at
-- brings them back.
alter table public.sprint_ai_runs add column archived_at timestamptz;
