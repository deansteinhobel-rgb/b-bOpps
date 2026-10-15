-- Reddit as a fourth ad platform (Dean, 2026-10-15: DNSFilter runs Reddit as part of its paid media).
-- Read through Windsor's reddit connector like the others. Additive only.
--
-- The new enum value can't be used in the same transaction that adds it, so nothing below inserts a
-- Reddit row; the account is mapped afterwards on Admin → client → Ad accounts.
--
-- Reddit's own target ($650 a result for DNSFilter, view-through conversions included, against $300
-- for the client) uses client_platform_accounts.kpi_target from 20261016000076 (#21).
alter type public.platform add value if not exists 'reddit';

-- Report boards can be embedded per platform, Reddit included.
alter table public.report_links drop constraint report_links_board_check;
alter table public.report_links add constraint report_links_board_check
  check (board in ('all', 'linkedin', 'google_ads', 'meta', 'reddit'));
