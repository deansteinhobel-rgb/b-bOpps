-- Competitor ads: Claude's relevance check (Dean, 2026-10-20), as for keyword ads. Big parent
-- companies run ads for every product they sell (Experian's credit reports next to Experian
-- Health, 8am's LawPay next to MyCase), so Claude reads each competitor's live ads against what the
-- client sells (its brief from Notion HQ) and marks them relevant, off_topic or unsure. Off-topic ads
-- leave the page and what Claude reads. Server-written (no write policies). Additive only.

alter table public.competitor_ads
  add column relevance text check (relevance is null or relevance in ('relevant', 'off_topic', 'unsure')),
  add column relevance_reason text check (relevance_reason is null or length(relevance_reason) <= 300),
  add column relevance_digest text,
  add column relevance_checked_at timestamptz;
