import { NextResponse, type NextRequest } from "next/server"
import { aiConfigured } from "@/lib/ai/claude"
import { extractPending } from "@/lib/calls/extract"
import { checkFollowUps } from "@/lib/calls/followups"
import { markCallsForRescan, syncCallNotes } from "@/lib/calls/notion"
import { buildClientBrief } from "@/lib/knowledge/brief"
import { createAdminClient } from "@/lib/supabase/admin"
import { isCron } from "@/lib/cron-auth"

export const maxDuration = 300

/**
 * Client call notes, every hour (Supabase Cron `call-notes-hourly`): reads new and edited call notes
 * from Notion (read only), has Claude summarize them and pull out what was said, and once a day per
 * client checks whether those things have happened. Each run stays within ~4 minutes; a long history
 * carries on in the next run. Requires `Authorization: Bearer $CRON_SECRET`.
 *
 * Friday night (Dean, 2026-10-21; Vercel cron): `?step=rescan` lists every client's calls in full
 * and marks them all to be read again, which the hourly runs work through overnight; `?step=briefs`
 * on Saturday morning rebuilds each client brief whose calls changed (unchanged ones are skipped).
 */
export async function GET(request: NextRequest) {
  if (!isCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const started = Date.now()
  const budget = 240_000
  const left = () => budget - (Date.now() - started)
  const db = createAdminClient()
  const step = request.nextUrl.searchParams.get("step")
  const { data: clients } = await db.from("clients").select("id, slug, call_followups_checked_at").eq("active", true).not("call_notes_notion_id", "is", null)
  const results: Record<string, unknown>[] = []
  if (step === "rescan" || step === "briefs") {
    for (const c of clients ?? []) {
      if (left() < (step === "briefs" ? 120_000 : 20_000)) break
      try {
        if (step === "rescan") results.push({ client: c.slug, ...(await markCallsForRescan(c.id)) })
        else if (aiConfigured()) results.push({ client: c.slug, brief: (await buildClientBrief(c.id)).skipped ? "unchanged" : "rebuilt" })
      } catch (err) {
        results.push({ client: c.slug, error: (err as Error).message })
      }
    }
    return NextResponse.json({ ok: results.every((r) => !r.error), step, results })
  }
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
