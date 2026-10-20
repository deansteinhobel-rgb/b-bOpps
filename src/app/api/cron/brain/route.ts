import { NextResponse, type NextRequest } from "next/server"
import { aiConfigured } from "@/lib/ai/claude"
import { buildClientBrief } from "@/lib/knowledge/brief"
import { discoverContentBank, readContentBank } from "@/lib/knowledge/content-bank"
import { discoverClientHq, readClientHq } from "@/lib/knowledge/notion-hq"
import { createAdminClient } from "@/lib/supabase/admin"
import { isCron } from "@/lib/cron-auth"

export const maxDuration = 300

/**
 * Keeps each Client brain current (run it a few times overnight, e.g. hourly 01:00-05:00). Each run
 * works within ~4 minutes: it picks the client whose brief is oldest, re-reads its Notion HQ and
 * its Content Bank rows (read only), and once every changed page is read, rebuilds the brief if anything changed.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  if (!isCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const started = Date.now()
  const budget = 240_000
  const db = createAdminClient()
  const { data: clients } = await db.from("clients").select("id, slug, notion_hq_page_id").eq("active", true)
  const { data: briefs } = await db.from("client_briefs").select("client_id, created_at").eq("status", "ready").order("created_at", { ascending: false })
  const lastBrief = (id: string) => briefs?.find((b) => b.client_id === id)?.created_at ?? ""
  const results: { client: string; pages?: number; bank?: number; read?: number; remaining?: number; brief?: string; error?: string }[] = []
  for (const c of [...(clients ?? [])].sort((a, b) => lastBrief(a.id).localeCompare(lastBrief(b.id)))) {
    if (Date.now() - started > budget * 0.5) break
    try {
      // Clients without an HQ still get their Content Bank rows (and call notes) into a brief.
      const d = c.notion_hq_page_id ? await discoverClientHq(c.id) : { pages: 0 }
      const r = c.notion_hq_page_id ? await readClientHq(c.id, { budgetMs: budget - (Date.now() - started) - 90_000 }) : { read: 0, remaining: 0 }
      const bank = await discoverContentBank(c.id)
      const rb = r.remaining ? { read: 0, remaining: 1 } : await readContentBank(c.id, { budgetMs: Math.max(10_000, budget - (Date.now() - started) - 90_000) })
      let brief = "waiting for pages"
      if (r.remaining === 0 && rb.remaining === 0 && aiConfigured()) brief = (await buildClientBrief(c.id)).skipped ? "unchanged" : "rebuilt"
      results.push({ client: c.slug, pages: d.pages, bank: bank.entries, read: r.read + rb.read, remaining: r.remaining + rb.remaining, brief })
    } catch (e) {
      results.push({ client: c.slug, error: (e as Error).message })
    }
  }
  return NextResponse.json({ ok: results.every((r) => !r.error), results })
}
