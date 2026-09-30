import { after, NextResponse } from "next/server"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
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
 */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!canEdit(me)) return NextResponse.json({ error: VIEW_ONLY }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { clientSlug?: string; full?: boolean; first?: boolean }
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, call_notes_notion_id").eq("slug", body.clientSlug ?? "").maybeSingle()
  if (!client) return NextResponse.json({ error: "This client isn't available to you." }, { status: 404 })
  if (!client.call_notes_notion_id) return NextResponse.json({ error: "Link the client's call notes first." }, { status: 400 })
  if (body.first) {
    const limited = await rateLimit(supabase, "call_notes")
    if (limited) return NextResponse.json({ error: limited }, { status: 429 })
  }
  try {
    const s = await syncCallNotes(client.id, { full: Boolean(body.full), budgetMs: 60_000 })
    if (s.remaining === 0 && aiConfigured()) {
      after(async () => {
        const e = await extractPending(client.id, { budgetMs: 240_000 }).catch(() => ({ remaining: 1 }))
        if (e.remaining === 0) await checkFollowUps(client.id).catch((err) => console.error("[calls] follow-ups", err))
      })
    }
    return NextResponse.json(s)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
