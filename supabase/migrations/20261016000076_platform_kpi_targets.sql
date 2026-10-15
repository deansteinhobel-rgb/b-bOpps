-- Optional cost per result target per ad account (Dean, 2026-10-15). Filevine runs LinkedIn at $550
-- and Meta at $450, and one blended client target judged LinkedIn too harshly and Meta too softly.
-- A platform's target is its active accounts' target (the lowest, if they differ); a platform with
-- none falls back to clients.monthly_kpi_target. Additive: existing rows stay null, so nothing changes
-- until an admin sets one. Admin-only writes, like the rest of the row (existing RLS policies).
alter table public.client_platform_accounts
  add column kpi_target numeric(12, 2) check (kpi_target is null or kpi_target > 0);

comment on column public.client_platform_accounts.kpi_target is
  'Target cost per result for this account''s platform; null = use clients.monthly_kpi_target.';
