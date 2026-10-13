-- Audiences to include (Dean, 2026-10-13): Claude's daily review also judges the LinkedIn audiences
-- (job function, industry, seniority) that click well above the rest of their campaign, so audiences
-- that aren't buyers stop showing up as opportunities. Additive only.
alter table public.insight_reviews
  add column audiences jsonb not null default '[]';   -- [{ id: "<kind>:<value>", fit: buyer | not_buyer | unsure, reason }]
