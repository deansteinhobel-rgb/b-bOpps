import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { londonToday } from "@/lib/checks/periods"
import { notionStage } from "./tests"

type Page = { notion_page_id: string; last_edited_time: string; properties: Record<string, unknown> }

/**
 * After a Notion sync: moves briefed tests along as their brief's statuses change (Dean,
 * 2026-09-30). Briefed → ready on Status Paid "Ready for Build" or Master Status "Client
 * Approved"; briefed or ready → live on Master Status "Production Complete" or Status Paid "Gone
 * Live". Only our own sprint_tests change (Notion is only read), only forwards, never in a closed
 * sprint. The live date is the day the brief was last edited; the team picks the campaigns.
 */
export async function advanceTestsFromNotion(db: SupabaseClient, pages: Page[]) {
  if (!pages.length) return { ready: 0, live: 0 }
  const byId = new Map(pages.map((p) => [p.notion_page_id, p]))
  let ready = 0
  let live = 0
  const ids = [...byId.keys()]
  for (let i = 0; i < ids.length; i += 200) {
    const { data: tests } = await db
      .from("sprint_tests")
      .select("id, status, ready_at, notion_page_id, sprints(closed_at)")
      .in("notion_page_id", ids.slice(i, i + 200))
      .in("status", ["briefed", "ready"])
      .is("outcome", null)
    for (const t of tests ?? []) {
      if ((t.sprints as unknown as { closed_at: string | null } | null)?.closed_at) continue
      const page = byId.get(t.notion_page_id as string)!
      const props = page.properties
      const stage = notionStage({ master: (props["Master Status"] as string) ?? null, paid: (props["Status Paid"] as string) ?? null })
      const now = new Date().toISOString()
      if (stage === "live") {
        await db
          .from("sprint_tests")
          .update({ status: "live", live_on: londonToday(new Date(page.last_edited_time)), ready_at: t.ready_at ?? now })
          .eq("id", t.id)
          .in("status", ["briefed", "ready"])
        live++
      } else if (stage === "ready" && t.status === "briefed") {
        await db.from("sprint_tests").update({ status: "ready", ready_at: now }).eq("id", t.id).eq("status", "briefed")
        ready++
      }
    }
  }
  return { ready, live }
}
