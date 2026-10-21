import "server-only"
import type { Db } from "@/lib/supabase/db"

/**
 * Per-person caps on the routes that spend money or take uploads (security review, 2026-09-29).
 * Generous for real use; they stop a stolen session or a runaway script. Checked with the user's own
 * Supabase client (take_rate_limit counts by auth.uid()).
 */
export const LIMITS = {
  news_chat: { max: 40, seconds: 3600, what: "news questions an hour" },
  campaign_chat: { max: 40, seconds: 3600, what: "campaign questions an hour" },
  sprint_pour: { max: 8, seconds: 86400, what: "pours a day" },
  insight_review: { max: 8, seconds: 86400, what: "reviews a day" },
  brain_refresh: { max: 12, seconds: 86400, what: "brain refreshes a day" },
  brain_upload: { max: 40, seconds: 86400, what: "file uploads a day" },
  avatar_upload: { max: 20, seconds: 3600, what: "picture uploads an hour" },
  feedback: { max: 20, seconds: 86400, what: "ideas and bug reports a day" },
  content_ideas: { max: 6, seconds: 86400, what: "content idea runs a day" },
  test_read: { max: 30, seconds: 86400, what: "test reads a day" },
  // A check counts once when it starts and once when Claude is scheduled: 40 = 20 checks a day.
  call_notes: { max: 40, seconds: 86400, what: "call note checks a day" },
  manual_call: { max: 10, seconds: 86400, what: "calls added by hand a day" },
  negative_push: { max: 30, seconds: 86400, what: "negative keyword pushes a day" },
  term_review: { max: 12, seconds: 86400, what: "search term checks a day" },
  // Google Ads ads from a sprint test (2026-10-15): one create, or one batch of pauses, counts once.
  google_ad_write: { max: 30, seconds: 86400, what: "Google Ads ad changes a day" },
  // Campaigns built through the platforms' own APIs (2026-10-21): saving or sending a build, dry runs included.
  campaign_build: { max: 20, seconds: 86400, what: "campaign builds a day" },
  // The campaign builder (2026-10-21): plans and re-plans with answers, edits to live campaigns, research by hand.
  campaign_plan: { max: 20, seconds: 86400, what: "campaign plans a day" },
  campaign_edit: { max: 30, seconds: 86400, what: "campaign edits a day" },
  targeting_lookup: { max: 300, seconds: 86400, what: "audience lookups a day" },
  playbook_research: { max: 4, seconds: 86400, what: "playbook research runs a day" },
  build_image: { max: 60, seconds: 86400, what: "ad image uploads a day" },
  // Aikido, 2026-10-13: everything else that calls Claude or Notion, or fetches from outside.
  brain_brief: { max: 12, seconds: 86400, what: "brief rebuilds a day" },
  brain_note: { max: 100, seconds: 86400, what: "notes a day" },
  hq_page_read: { max: 100, seconds: 86400, what: "HQ page reads a day" },
  notion_refresh: { max: 30, seconds: 3600, what: "Notion refreshes an hour" },
  notion_write: { max: 30, seconds: 86400, what: "Notion actions and briefs a day" },
  ad_post_link: { max: 60, seconds: 86400, what: "post links a day" },
  // Content library (2026-10-14): placing a piece and "Ask Claude again" share one limit.
  content_page_read: { max: 40, seconds: 86400, what: "page reads a day" },
  content_placement: { max: 30, seconds: 86400, what: "content placements and re-picks a day" },
  content_angle: { max: 150, seconds: 86400, what: "email angles a day" },
  // Competitor ads (2026-10-20): editing the list, and reading the libraries again before Sunday.
  competitor_edit: { max: 60, seconds: 86400, what: "competitor changes a day" },
  competitor_refresh: { max: 2, seconds: 86400, what: "competitor refreshes a day" },
} as const
export type LimitKind = keyof typeof LIMITS

/** Null when allowed (and counted); otherwise the message to show. */
export async function rateLimit(supabase: Db, kind: LimitKind): Promise<string | null> {
  const l = LIMITS[kind]
  const { data, error } = await supabase.rpc("take_rate_limit", { p_kind: kind, p_max: l.max, p_window_seconds: l.seconds })
  if (error) {
    console.error("rate limit check failed", error)
    return "Couldn't check your usage just now. Try again in a moment."
  }
  return data ? null : `You've hit the limit of ${l.max} ${l.what}. Try again later, or ask an admin if you need more.`
}
