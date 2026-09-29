import { after, NextResponse } from "next/server"
import { getProfile, isAdmin } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { buildClientBrief } from "@/lib/knowledge/brief"
import { discoverClientHq, readClientHq } from "@/lib/knowledge/notion-hq"
import { createAdminClient } from "@/lib/supabase/admin"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

// Each step stays well inside this; the brief (about a minute) runs after the response.
export const maxDuration = 300

/**
 * Refresh the Client brain in steps the browser drives, so no request runs long:
 *   step "discover": find the HQ's pages (read only)
 *   step "read":     read changed pages for up to ~60s; returns how many are left (call again)
 *   step "brief":    rebuild the brief with Claude in the background; returns the row id to poll
 * GTM leads and admins only.
 */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!isAdmin(me)) return NextResponse.json({ error: "Only GTM leads and admins can refresh the brain." }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { clientSlug?: string; step?: string; since?: string; force?: boolean }
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, notion_hq_page_id").eq("slug", body.clientSlug ?? "").maybeSingle()
  if (!client) return NextResponse.json({ error: "This client isn't available to you." }, { status: 404 })

  try {
    if (body.step === "discover") {
      // A refresh starts with "discover" (then reads and a Claude brief), so that's what is counted.
      const limited = await rateLimit(supabase, "brain_refresh")
      if (limited) return NextResponse.json({ error: limited }, { status: 429 })
      if (!client.notion_hq_page_id) return NextResponse.json({ pages: 0, added: 0 })
      return NextResponse.json(await discoverClientHq(client.id, { full: Boolean(body.force) }))
    }
    if (body.step === "read") return NextResponse.json(await readClientHq(client.id, { since: body.since, budgetMs: 60_000 }))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  if (body.step !== "brief") return NextResponse.json({ error: "Unknown step." }, { status: 400 })

  if (!aiConfigured()) return NextResponse.json({ error: "Claude isn't set up yet: add ANTHROPIC_API_KEY to .env.local." }, { status: 503 })
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
