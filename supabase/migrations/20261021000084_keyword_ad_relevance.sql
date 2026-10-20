-- Keyword ads: Claude's relevance check (Dean, 2026-10-20). Broad keyword searches return
-- off-topic ads (a crowdfunding launch for "DNS filtering", a doctor for "managed service
-- provider"), and some became "running longest" picks. Claude reads each search's top 30 and
-- marks every ad relevant, off_topic or unsure; off-topic ads can't be picks. Server-written, like
-- the rest of keyword_ads (no write policies). Additive only.

alter table public.keyword_ads
  add column relevance text check (relevance is null or relevance in ('relevant', 'off_topic', 'unsure')),
  add column relevance_reason text check (relevance_reason is null or length(relevance_reason) <= 300),
  -- A digest of what Claude saw (keyword, advertiser, copy), so an ad is checked again only when that changes.
  add column relevance_digest text,
  add column relevance_checked_at timestamptz;
