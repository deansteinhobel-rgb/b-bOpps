import { after, NextResponse } from "next/server"
import { canEdit, getProfile } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { runContentIdeas, startContentIdeas } from "@/lib/content/generate"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

// A run takes a minute or two and runs after the response (see `after`), within this limit.
export const maxDuration = 300

/** "Get content ideas" on At a glance: the client's team (not viewers). Returns the run id to poll. */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!canEdit(me)) return NextResponse.json({ error: "You have view access, so you can't run this." }, { status: 403 })
  if (!aiConfigured()) return NextResponse.json({ error: "Claude isn't set up yet: add ANTHROPIC_API_KEY to .env.local and restart." }, { status: 503 })
  const { clientSlug } = (await request.json().catch(() => ({}))) as { clientSlug?: string }
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", clientSlug ?? "").maybeSingle()
  if (!client) return NextResponse.json({ error: "This client isn't available to you." }, { status: 404 })
  const { data: allowed } = await supabase.rpc("can_edit_client", { cid: client.id })
  if (!allowed) return NextResponse.json({ error: "Only the client's team can run this." }, { status: 403 })

  // One at a time per client (one older than 10 minutes counts as stuck).
  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: running } = await supabase.from("content_idea_runs").select("id").eq("client_id", client.id).eq("status", "generating").gte("created_at", since).maybeSingle()
  if (running) return NextResponse.json({ runId: running.id })
  const limited = await rateLimit(supabase, "content_ideas")
  if (limited) return NextResponse.json({ error: limited }, { status: 429 })
  const runId = await startContentIdeas(client.id, me.id)
  after(() => runContentIdeas(runId))
  return NextResponse.json({ runId })
}

/** Status of a run (read through RLS). */
export async function GET(request: Request) {
  await getProfile()
  const id = new URL(request.url).searchParams.get("run")
  if (!id) return NextResponse.json({ error: "Missing run." }, { status: 400 })
  const supabase = await createClient()
  const { data } = await supabase.from("content_idea_runs").select("status, progress, error").eq("id", id).maybeSingle()
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 })
  return NextResponse.json(data)
}
