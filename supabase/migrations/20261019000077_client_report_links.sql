-- Client reports (Dean, 2026-10-19): a report the team builds step by step (platform, then one
-- campaign or all of them, then the dates) and shares with the client through the same secret,
-- view-only links as the report boards. Additive only.
--
-- kind: 'board' = a report board as before; 'client_report' = the step-by-step report.
-- campaign_id: the one campaign a client report covers (its platform is in `board`); null = all.
-- note: an optional note from the team, shown on the report under the summary.
alter table public.report_links add column kind text not null default 'board' check (kind in ('board', 'client_report'));
alter table public.report_links add column campaign_id text check (length(campaign_id) <= 100);
alter table public.report_links add column note text check (length(note) <= 2000);
-- One campaign belongs to one platform, and only client reports pick a campaign.
alter table public.report_links add constraint report_links_campaign_check
  check (campaign_id is null or (kind = 'client_report' and board <> 'all'));
-- The insert and turn-off policies are unchanged: the new columns are set once, on insert, and the
-- update grant still only covers revoked_at and revoked_by_profile_id.
