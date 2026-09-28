-- Easier review (Dean): each suggestion gets a one-line summary, an impact rating, a short
-- expected-impact line and 2-3 key numbers, so the list can be ranked and scanned.
alter table public.sprint_recommendations
  add column summary text,
  add column impact text check (impact in ('low', 'medium', 'high')),
  add column expected_impact text,
  add column evidence jsonb not null default '[]'; -- [{ label, value }], e.g. { "Meta pace", "41%" }
