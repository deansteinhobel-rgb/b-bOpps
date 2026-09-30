import { NextResponse, type NextRequest } from "next/server"
import { aiConfigured } from "@/lib/ai/claude"
import { runInsightReview, startInsightReview } from "@/lib/insights/review"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 300

/**
 * Claude's daily review of each client's Optimize now feed (performance phase 4). Run it after the
 * morning Windsor and breakdown syncs, a few times (e.g. hourly 06:00-08:00): each run reviews the
 * clients whose last review is over 20 hours old, oldest first, within ~4 minutes.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  if (!aiConfigured()) return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY isn't set." })
  const started = Date.now()
  const db = createAdminClient()
  const [{ data: clients }, { data: reviews }] = await Promise.all([
    // Only clients with a connected ad account (new clients have no data to review yet).
    db.from("clients").select("id, slug, client_platform_accounts!inner(id)").eq("active", true).eq("client_platform_accounts.active", true),
    db.from("insight_reviews").select("client_id, created_at").in("status", ["ready", "generating"]).order("created_at", { ascending: false }).limit(500),
  ])
  const last = (id: string) => reviews?.find((r) => r.client_id === id)?.created_at ?? ""
  const due = [...new Map((clients ?? []).map((c) => [c.id, c])).values()].filter((c) => !last(c.id) || Date.now() - Date.parse(last(c.id)) > 20 * 3600e3).sort((a, b) => last(a.id).localeCompare(last(b.id)))
  const results: { client: string; status?: string; error?: string }[] = []
  for (const c of due) {
    if (Date.now() - started > 150_000) break // a review takes about a minute
    try {
      const id = await startInsightReview(c.id, null)
      await runInsightReview(id)
      const { data } = await db.from("insight_reviews").select("status, error").eq("id", id).single()
      results.push({ client: c.slug, status: data?.status, error: data?.error ?? undefined })
    } catch (e) {
      results.push({ client: c.slug, error: (e as Error).message })
    }
  }
  return NextResponse.json({ ok: results.every((r) => !r.error), results })
}
