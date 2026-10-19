-- Asset-level numbers for Google Ads campaigns with no ad rows (Dean, 2026-10-19).
--   pmax_asset        Performance Max assets, daily: group = asset group, dim1 = asset id, dim2 = field type
--                     (HEADLINE, LONG_HEADLINE, DESCRIPTION, MARKETING_IMAGE, YOUTUBE_VIDEO, LOGO...).
--                     extra: asset type, text, image URL, video title and id, the asset group's ad strength.
--   ad_asset          Demand Gen (and Display / Video) ad group ad assets, daily: group = ad group, same dims.
--   pmax_search_term  Performance Max search terms (campaign search term view), daily, rows with spend or
--                     conversions only: dim1 = term. Search campaigns stay on `search_term`.
-- Additive: the kind check gets three more values; nothing else changes.
alter table public.windsor_breakdowns drop constraint windsor_breakdowns_kind_check;
alter table public.windsor_breakdowns add constraint windsor_breakdowns_kind_check check (kind in (
  'search_term', 'keyword', 'impression_share',
  'li_company', 'li_job_title', 'li_seniority', 'li_industry', 'li_job_function',
  'meta_age_gender', 'meta_placement', 'meta_adset', 'meta_adset_7d',
  'ga4_landing_page',
  'pmax_asset', 'ad_asset', 'pmax_search_term'
));
