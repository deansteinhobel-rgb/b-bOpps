import { after, NextResponse } from "next/server"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { buildClientBrief } from "@/lib/knowledge/brief"
import { discoverContentBank, readContentBank, staleEntries } from "@/lib/knowledge/content-bank"
import { discoverClientHq, readClientHq } from "@/lib/knowledge/notion-hq"
import { createAdminClient } from "@/lib/supabase/admin"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

// Each step stays well inside this; the brief (about a minute) runs after the response.
export const maxDuration = 300

/**
 * Refresh the Client brain in steps the browser drives, so no request runs long:
 *   step "discover": find the HQ's pages and the client's Content Bank rows (read only)
 *   step "read":     read changed pages and rows for up to ~60s; returns how many are left (call again)
 *   step "brief":    rebuild the brief with Claude in the background; returns the row id to poll
 * Anyone who can edit the client.
 */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!canEdit(me)) return NextResponse.json({ error: VIEW_ONLY }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { clientSlug?: string; step?: string; since?: string; force?: boolean }
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, notion_hq_page_id").eq("slug", body.clientSlug ?? "").maybeSingle()
  if (!client) return NextResponse.json({ error: "This client isn't available to you." }, { status: 404 })

  try {
    if (body.step === "discover") {
      // A refresh starts with "discover" (then reads and a Claude brief), so that's what is counted.
      const limited = await rateLimit(supabase, "brain_refresh")
      if (limited) return NextResponse.json({ error: limited }, { status: 429 })
      const hq = client.notion_hq_page_id ? await discoverClientHq(client.id, { full: Boolean(body.force) }) : { pages: 0, added: 0 }
      const bank = await discoverContentBank(client.id)
      return NextResponse.json({ ...hq, bank })
    }
    if (body.step === "read") {
      const started = Date.now()
      const hq = await readClientHq(client.id, { since: body.since, budgetMs: 60_000 })
      // The Content Bank's rows once the HQ is done; until then they count as left.
      const bank = hq.remaining ? { read: 0, remaining: (await staleEntries(client.id, body.since)).length, errors: [] as string[] } : await readContentBank(client.id, { since: body.since, budgetMs: Math.max(5_000, 60_000 - (Date.now() - started)) })
      return NextResponse.json({ read: hq.read + bank.read, remaining: hq.remaining + bank.remaining, errors: [...hq.errors, ...bank.errors] })
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  if (body.step !== "brief") return NextResponse.json({ error: "Unknown step." }, { status: 400 })

  if (!aiConfigured()) return NextResponse.json({ error: "Claude isn't set up yet: add ANTHROPIC_API_KEY to .env.local." }, { status: 503 })
  // Each brief is an Opus run (Aikido / security audit L3): counted on its own, not only via discover.
  const briefLimited = await rateLimit(supabase, "brain_brief")
  if (briefLimited) return NextResponse.json({ error: briefLimited }, { status: 429 })
  const db = createAdminClient()
  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: running } = await db.from("client_briefs").select("id").eq("client_id", client.id).eq("status", "generating").gte("created_at", since).maybeSingle()
  if (running) return NextResponse.json({ briefId: running.id })
  const { data: brief } = await db.from("client_briefs").insert({ client_id: client.id, status: "generating", written_by: "claude", created_by_profile_id: me.id }).select("id").single()
  if (!brief) return NextResponse.json({ error: "Couldn't start." }, { status: 500 })
  after(async () => {
    await buildClientBrief(client.id, { force: Boolean(body.force), requestedBy: me.id, briefId: brief.id }).catch(() => {})
  })
  return NextResponse.json({ briefId: brief.id })
}

/** Status of a rebuild, read through RLS. */
export async function GET(request: Request) {
  await getProfile()
  const id = new URL(request.url).searchParams.get("brief")
  if (!id) return NextResponse.json({ error: "Missing brief." }, { status: 400 })
  const supabase = await createClient()
  const { data } = await supabase.from("client_briefs").select("status, error").eq("id", id).maybeSingle()
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 })
  return NextResponse.json(data)
}
