import { after, NextResponse } from "next/server"
import { canEdit, getProfile, isAdmin, VIEW_ONLY } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { extractPending } from "@/lib/calls/extract"
import { checkFollowUps } from "@/lib/calls/followups"
import { syncCallNotes } from "@/lib/calls/notion"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 300

/**
 * "Check for new calls" on the Brain tab: reads the client's call notes from Notion (read only) for
 * up to ~60s, then Claude reads the new ones and the follow-up check runs, in the background. The
 * client's team (not viewers). Returns how many calls are still waiting to be read (call again).
 *
 * Rate limit (security audit 2026-10, M1): `first` comes from the browser, so it can't be what
 * decides. A check counts once when it starts (`first`) and once more when a later request finishes
 * the read and schedules Claude, so leaving `first` out still counts. The follow-up check only re-runs
 * when Claude read new calls or the last check is over an hour old. Re-reading everything (`full`)
 * is for admins, who link the call notes.
 */
const FOLLOWUPS_FRESH_MS = 3600_000

export async function POST(request: Request) {
  const me = await getProfile()
  if (!canEdit(me)) return NextResponse.json({ error: VIEW_ONLY }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { clientSlug?: string; full?: boolean; first?: boolean }
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, call_notes_notion_id, call_followups_checked_at").eq("slug", body.clientSlug ?? "").maybeSingle()
  if (!client) return NextResponse.json({ error: "This client isn't available to you." }, { status: 404 })
  if (!client.call_notes_notion_id) return NextResponse.json({ error: "Link the client's call notes first." }, { status: 400 })
  const first = body.first === true
  if (first) {
    const limited = await rateLimit(supabase, "call_notes")
    if (limited) return NextResponse.json({ error: limited }, { status: 429 })
  }
  try {
    // Without `full`, a request only carries on with calls still waiting, so uncounted requests run out of work.
    const s = await syncCallNotes(client.id, { full: body.full === true && isAdmin(me), budgetMs: 60_000 })
    if (s.remaining === 0 && aiConfigured()) {
      if (!first) {
        const limited = await rateLimit(supabase, "call_notes")
        if (limited) return NextResponse.json({ error: limited }, { status: 429 })
      }
      const checked = client.call_followups_checked_at ? Date.parse(client.call_followups_checked_at) : 0
      after(async () => {
        const e = await extractPending(client.id, { budgetMs: 240_000 }).catch(() => ({ extracted: 0, remaining: 1 }))
        const stale = Date.now() - checked > FOLLOWUPS_FRESH_MS
        if (e.remaining === 0 && (e.extracted > 0 || stale)) await checkFollowUps(client.id).catch((err) => console.error("[calls] follow-ups", err))
      })
    }
    return NextResponse.json(s)
  } catch (e) {
    console.error("[calls] check failed", e)
    return NextResponse.json({ error: "Couldn't read the call notes just now. Try again in a minute." }, { status: 500 })
  }
}
