import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * A person's own activity in the app, all time and in the last 30 days (Options → Your stats).
 * Counts only rows the person created, so reading them with the admin client is safe.
 */
const STATS = [
  { key: "tests", label: "Tests planned", table: "sprint_tests", by: "created_by_profile_id", at: "created_at" },
  { key: "changes", label: "Changes logged", table: "sprint_changes", by: "created_by_profile_id", at: "created_at" },
  { key: "checks", label: "Checks done", table: "check_results", by: "checked_by_profile_id", at: "checked_at" },
  { key: "notion", label: "Notion actions and briefs", table: "notion_write_log", by: "profile_id", at: "created_at", skip: ["operation", "create_comment"] },
  { key: "insights", label: "Insights handled", table: "insight_actions", by: "profile_id", at: "created_at" },
  { key: "pours", label: "Sprints poured", table: "sprint_ai_runs", by: "requested_by_profile_id", at: "created_at" },
  { key: "decided", label: "Suggestions decided", table: "sprint_recommendations", by: "decided_by_profile_id", at: "decided_at" },
  { key: "closed", label: "Sprints closed", table: "sprints", by: "closed_by_profile_id", at: "closed_at" },
  { key: "notes", label: "Brain notes", table: "client_knowledge", by: "created_by_profile_id", at: "created_at" },
  { key: "feedback", label: "Ideas and bugs sent", table: "feedback", by: "profile_id", at: "created_at" },
] as const

export type Stat = { key: string; label: string; total: number; last30: number }

export async function myStats(profileId: string): Promise<{ stats: Stat[]; proven: number; called: number }> {
  const db = createAdminClient()
  const since = new Date(Date.now() - 30 * 864e5).toISOString()
  const count = async (table: string, by: string, at?: string, skip?: readonly [string, string]) => {
    let q = db.from(table).select("*", { count: "exact", head: true }).eq(by, profileId)
    if (skip) q = q.neq(skip[0], skip[1])
    if (at) q = q.gte(at, since)
    const { count: n } = await q
    return n ?? 0
  }
  const [stats, proven, called] = await Promise.all([
    Promise.all(STATS.map(async (s) => ({ key: s.key, label: s.label, total: await count(s.table, s.by, undefined, "skip" in s ? s.skip : undefined), last30: await count(s.table, s.by, s.at, "skip" in s ? s.skip : undefined) }))),
    db.from("sprint_tests").select("*", { count: "exact", head: true }).eq("created_by_profile_id", profileId).eq("outcome", "proven").then((r) => r.count ?? 0),
    db.from("sprint_tests").select("*", { count: "exact", head: true }).eq("created_by_profile_id", profileId).in("outcome", ["proven", "disproven", "inconclusive"]).then((r) => r.count ?? 0),
  ])
  return { stats, proven, called }
}
