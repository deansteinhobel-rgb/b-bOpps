import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { londonToday } from "@/lib/checks/periods"
import { cachedInsights } from "@/lib/metrics/cached"
import { applyActions, type LoggedAction } from "./rules"

/**
 * The feed for one client: the cached rule output with the team's log applied (read live, through
 * RLS). SECURITY: only call after the client row was loaded with the user's own RLS client, because
 * cachedInsights reads with the admin client.
 */
export async function loadFeed(supabase: SupabaseClient, clientId: string) {
  const [computed, { data: log }, { data: reviews }] = await Promise.all([
    cachedInsights(clientId),
    supabase.from("insight_actions").select("insight_key, action, items, snooze_until, created_at, note, notion_page_id, sprint_test_id, profiles(full_name)").eq("client_id", clientId).order("created_at"),
    supabase.from("insight_reviews").select("id, status, headline, start_here, ranking, created_at, finished_at, error").eq("client_id", clientId).order("created_at", { ascending: false }).limit(5),
  ])
  if (!computed) return null
  const actions: LoggedAction[] = (log ?? []).map((a) => ({ ...(a as unknown as LoggedAction), profile_name: (a.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null }))
  // Claude's latest finished review ranks the feed; a newer one may be running.
  const review = (reviews ?? []).find((r) => r.status === "ready") ?? null
  const running = (reviews ?? []).find((r) => r.status === "generating" && Date.now() - Date.parse(r.created_at) < 10 * 60_000) ?? null
  const rank = new Map(((review?.ranking ?? []) as { key: string; why_now: string }[]).map((r, i) => [r.key, { rank: i + 1, whyNow: r.why_now }]))
  const insights = applyActions(computed.insights, actions, londonToday()).map((i) => ({ ...i, claude: rank.get(i.key) ?? null }))
  return {
    ...computed,
    insights,
    review: review
      ? { id: review.id as string, headline: review.headline as string | null, startHere: (review.start_here ?? []) as { key: string; why: string }[], at: (review.finished_at ?? review.created_at) as string }
      : null,
    reviewRunning: running ? (running.id as string) : null,
    lastReviewFailed: (reviews ?? [])[0]?.status === "failed" ? ((reviews ?? [])[0].error as string | null) ?? "failed" : null,
  }
}
