import { NextResponse, type NextRequest } from "next/server"
import { aiConfigured } from "@/lib/ai/claude"
import { extractPending } from "@/lib/calls/extract"
import { checkFollowUps } from "@/lib/calls/followups"
import { syncCallNotes } from "@/lib/calls/notion"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 300

/**
 * Client call notes, every hour (Supabase Cron `call-notes-hourly`): reads new and edited call notes
 * from Notion (read only), has Claude summarize them and pull out what was said, and once a day per
 * client checks whether those things have happened. Each run stays within ~4 minutes; a long history
 * carries on in the next run. Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const started = Date.now()
  const budget = 240_000
  const left = () => budget - (Date.now() - started)
  const db = createAdminClient()
  const { data: clients } = await db.from("clients").select("id, slug, call_followups_checked_at").eq("active", true).not("call_notes_notion_id", "is", null)
  const results: Record<string, unknown>[] = []
  for (const c of clients ?? []) {
    if (left() < 60_000) break
    try {
      const s = await syncCallNotes(c.id, { budgetMs: Math.min(60_000, left() - 45_000) })
      const e = aiConfigured() ? await extractPending(c.id, { budgetMs: Math.min(120_000, left() - 30_000) }) : { extracted: 0, remaining: 0 }
      const stale = !c.call_followups_checked_at || Date.now() - Date.parse(c.call_followups_checked_at) > 20 * 3600_000
      const f = aiConfigured() && stale && e.remaining === 0 && left() > 45_000 ? await checkFollowUps(c.id) : null
      results.push({ client: c.slug, ...s, ...e, followups: f })
    } catch (err) {
      results.push({ client: c.slug, error: (err as Error).message })
    }
  }
  return NextResponse.json({ ok: results.every((r) => !r.error), results })
}
