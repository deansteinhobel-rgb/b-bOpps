-- Reddit as a fourth ad platform (Dean, 2026-10-15: DNSFilter runs Reddit as part of its paid media).
-- Read through Windsor's reddit connector like the others. Additive only.
--
-- The new enum value can't be used in the same transaction that adds it, so nothing below inserts a
-- Reddit row; the account is mapped afterwards on Admin → client → Ad accounts.
alter type public.platform add value if not exists 'reddit';

-- Report boards can be embedded per platform, Reddit included.
alter table public.report_links drop constraint report_links_board_check;
alter table public.report_links add constraint report_links_board_check
  check (board in ('all', 'linkedin', 'google_ads', 'meta', 'reddit'));

-- A platform's own target cost per result, over the client's (Reddit for DNSFilter: $650 a result,
-- view-through conversions included, against $300 for the client). Null = the client's target.
alter table public.client_platform_accounts add column target_cost_per_result numeric(12, 2)
  check (target_cost_per_result is null or target_cost_per_result > 0);
comment on column public.client_platform_accounts.target_cost_per_result is
  'Target cost per result for this platform, over clients.monthly_kpi_target. Null = the client''s target.';
