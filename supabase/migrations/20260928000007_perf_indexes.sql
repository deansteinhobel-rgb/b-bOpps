-- Speeds up per-ad lookups (ad_fatigue_inputs joins metrics back by client/platform/account/ad).
create index if not exists windsor_daily_metrics_ad_idx
  on public.windsor_daily_metrics (client_id, platform, external_account_id, ad_id, date);
