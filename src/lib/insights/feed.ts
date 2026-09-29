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
  const [computed, { data: log }] = await Promise.all([
    cachedInsights(clientId),
    supabase.from("insight_actions").select("insight_key, action, items, snooze_until, created_at, note, notion_page_id, sprint_test_id, profiles(full_name)").eq("client_id", clientId).order("created_at"),
  ])
  if (!computed) return null
  const actions: LoggedAction[] = (log ?? []).map((a) => ({ ...(a as unknown as LoggedAction), profile_name: (a.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null }))
  return { ...computed, insights: applyActions(computed.insights, actions, londonToday()) }
}
