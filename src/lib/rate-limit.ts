import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

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
  call_notes: { max: 20, seconds: 86400, what: "call note checks a day" },
  negative_push: { max: 30, seconds: 86400, what: "negative keyword pushes a day" },
} as const
export type LimitKind = keyof typeof LIMITS

/** Null when allowed (and counted); otherwise the message to show. */
export async function rateLimit(supabase: SupabaseClient, kind: LimitKind): Promise<string | null> {
  const l = LIMITS[kind]
  const { data, error } = await supabase.rpc("take_rate_limit", { p_kind: kind, p_max: l.max, p_window_seconds: l.seconds })
  if (error) {
    console.error("rate limit check failed", error)
    return "Couldn't check your usage just now. Try again in a moment."
  }
  return data ? null : `You've hit the limit of ${l.max} ${l.what}. Try again later, or ask an admin if you need more.`
}
