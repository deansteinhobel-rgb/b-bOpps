import { NextResponse, type NextRequest } from "next/server"
import { aiConfigured } from "@/lib/ai/claude"
import { buildClientBrief } from "@/lib/knowledge/brief"
import { discoverClientHq, readClientHq } from "@/lib/knowledge/notion-hq"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 300

/**
 * Keeps each Client brain current (run it a few times overnight, e.g. hourly 01:00-05:00). Each run
 * works within ~4 minutes: it picks the client whose brief is oldest, re-reads its Notion HQ
 * (read only), and once every changed page is read, rebuilds the brief if anything changed.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const started = Date.now()
  const budget = 240_000
  const db = createAdminClient()
  const { data: clients } = await db.from("clients").select("id, slug").eq("active", true).not("notion_hq_page_id", "is", null)
  const { data: briefs } = await db.from("client_briefs").select("client_id, created_at").eq("status", "ready").order("created_at", { ascending: false })
  const lastBrief = (id: string) => briefs?.find((b) => b.client_id === id)?.created_at ?? ""
  const results: { client: string; pages?: number; read?: number; remaining?: number; brief?: string; error?: string }[] = []
  for (const c of [...(clients ?? [])].sort((a, b) => lastBrief(a.id).localeCompare(lastBrief(b.id)))) {
    if (Date.now() - started > budget * 0.5) break
    try {
      const d = await discoverClientHq(c.id)
      const r = await readClientHq(c.id, { budgetMs: budget - (Date.now() - started) - 90_000 })
      let brief = "waiting for pages"
      if (r.remaining === 0 && aiConfigured()) brief = (await buildClientBrief(c.id)).skipped ? "unchanged" : "rebuilt"
      results.push({ client: c.slug, pages: d.pages, read: r.read, remaining: r.remaining, brief })
    } catch (e) {
      results.push({ client: c.slug, error: (e as Error).message })
    }
  }
  return NextResponse.json({ ok: results.every((r) => !r.error), results })
}
