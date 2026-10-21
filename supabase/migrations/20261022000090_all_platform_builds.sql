-- Campaign builds and edits for every platform (Dean, 2026-10-21): Google Ads, Meta, Reddit and
-- Microsoft Ads join LinkedIn. Google and Meta go through Windsor's write actions, Reddit and
-- Microsoft through their own APIs. Everything is still created paused, every call is logged first,
-- and there is still no enable, remove or delete. Additive only: the checks get wider.

alter table public.campaign_builds drop constraint campaign_builds_platform_check;
alter table public.campaign_builds add constraint campaign_builds_platform_check
  check (platform in ('linkedin', 'reddit', 'google_ads', 'meta', 'microsoft_ads'));

alter table public.campaign_build_plans drop constraint campaign_build_plans_platform_check;
alter table public.campaign_build_plans add constraint campaign_build_plans_platform_check
  check (platform in ('linkedin', 'reddit', 'google_ads', 'meta', 'microsoft_ads'));

alter table public.platform_write_log drop constraint platform_write_log_platform_check;
alter table public.platform_write_log add constraint platform_write_log_platform_check
  check (platform in ('google_ads', 'linkedin', 'reddit', 'meta', 'microsoft_ads'));

-- New steps: Meta ad sets, Google keywords, locations, languages and extensions; edits to Meta ad
-- sets (pause, budget, name, end date, targeting read whole first).
alter table public.platform_write_log drop constraint platform_write_log_operation_check;
alter table public.platform_write_log add constraint platform_write_log_operation_check
  check (operation in (
    'push_negative_keywords', 'create_responsive_search_ad', 'pause_ad',
    'create_campaign_group', 'create_campaign', 'create_ad_group', 'upload_image', 'create_post', 'create_ad',
    'pause_campaign', 'update_campaign',
    'create_ad_set', 'add_keywords', 'set_locations', 'set_languages', 'create_asset',
    'pause_ad_set', 'update_ad_set'
  ));

-- The playbook covers Microsoft Ads too.
alter table public.ad_playbooks drop constraint ad_playbooks_platform_check;
alter table public.ad_playbooks add constraint ad_playbooks_platform_check
  check (platform in ('linkedin', 'google_ads', 'meta', 'reddit', 'microsoft_ads'));
alter table public.ad_playbook_rules drop constraint ad_playbook_rules_platform_check;
alter table public.ad_playbook_rules add constraint ad_playbook_rules_platform_check
  check (platform in ('linkedin', 'google_ads', 'meta', 'reddit', 'microsoft_ads'));
alter table public.ad_naming_conventions drop constraint ad_naming_conventions_platform_check;
alter table public.ad_naming_conventions add constraint ad_naming_conventions_platform_check
  check (platform in ('linkedin', 'google_ads', 'meta', 'reddit', 'microsoft_ads'));

-- House rules for the new platforms, like LinkedIn's seed (the team edits them on the builder).
insert into public.ad_playbook_rules (platform, kind, title, body, check_rule) values
  ('google_ads', 'practice', 'Check networks after a build', 'Windsor creates Search campaigns with Google''s default networks. Before turning a new campaign on, switch Search Partners and the Display Network off in Google Ads unless the test calls for them.', null),
  ('google_ads', 'practice', 'Exact and phrase match first', 'Start new Search ad groups on exact and phrase match keywords from converting search terms; add broad only with Smart Bidding and enough conversions.', null),
  ('google_ads', 'guardrail', 'Headlines up to 30 characters', 'Google refuses longer headlines.', '{"field": "headlineLength", "op": "max", "value": 30}'),
  ('meta', 'guardrail', 'Audience Network off', 'New ad sets run on Facebook and Instagram only.', '{"field": "audienceNetwork", "op": "forbid"}'),
  ('meta', 'practice', 'Advantage+ audience off on custom audiences', 'When an ad set is built on a custom audience (a list or retargeting), keep Advantage+ audience off so Meta doesn''t widen it.', null),
  ('reddit', 'practice', 'Communities and interests, not broad', 'Target named communities and interests that match the ICP rather than running broad.', null),
  ('microsoft_ads', 'practice', 'Start from what works in Google Ads', 'Mirror converting Google Search campaigns, keywords and copy before trying anything new on Microsoft.', null);
