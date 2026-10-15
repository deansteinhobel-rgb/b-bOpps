-- Google Ads ad writes from a sprint test (Dean, 2026-10-15). Besides negative keywords, the app may
-- now create a responsive search ad (always paused) and pause an ad, through Windsor. Same log as
-- negatives: every write is logged here first, then sent only when WINDSOR_WRITES_ENABLED=true,
-- WINDSOR_DRY_RUN=false and WINDSOR_AD_WRITES_ENABLED=true, then the log gets the result.
-- Additive only: two new operations, the ad (paused, or created) and the sprint test it was for.
-- Nothing enables, edits, removes or deletes ads.
alter table public.platform_write_log drop constraint platform_write_log_operation_check;
alter table public.platform_write_log add constraint platform_write_log_operation_check
  check (operation in ('push_negative_keywords', 'create_responsive_search_ad', 'pause_ad'));

alter table public.platform_write_log
  add column ad_id text,                                                -- pause_ad: the ad paused; create: the new ad, once Google returns it
  add column sprint_test_id uuid references public.sprint_tests (id);   -- the test the ad change was made for

create index platform_write_log_test_idx on public.platform_write_log (sprint_test_id) where sprint_test_id is not null;
