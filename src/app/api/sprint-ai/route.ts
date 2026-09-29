import { after, NextResponse } from "next/server"
import { getProfile, isAdmin } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { generateSprintPlan } from "@/lib/ai/generate"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

// A generation takes 1-3 minutes and runs after the response (see `after`), within this limit.
export const maxDuration = 300

/** Start "Pour me a sprint" for a sprint. GTM leads and admins only. Returns the run id to poll. */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!isAdmin(me)) return NextResponse.json({ error: "Only GTM leads and admins can generate a sprint." }, { status: 403 })
  if (!aiConfigured()) return NextResponse.json({ error: "Claude isn't set up yet: add ANTHROPIC_API_KEY to .env.local and restart." }, { status: 503 })
  const { sprintId } = (await request.json().catch(() => ({}))) as { sprintId?: string }
  if (!sprintId) return NextResponse.json({ error: "Missing sprint." }, { status: 400 })

  const supabase = await createClient()
  const { data: sprint } = await supabase.from("sprints").select("id, client_id, closed_at").eq("id", sprintId).maybeSingle()
  if (!sprint) return NextResponse.json({ error: "This sprint isn't available to you." }, { status: 404 })
  if (sprint.closed_at) return NextResponse.json({ error: "This sprint is closed." }, { status: 400 })

  // One pour at a time per sprint (a run older than 10 minutes counts as stuck).
  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: running } = await supabase.from("sprint_ai_runs").select("id").eq("sprint_id", sprintId).eq("status", "generating").gte("created_at", since).maybeSingle()
  if (running) return NextResponse.json({ runId: running.id })
  const limited = await rateLimit(supabase, "sprint_pour")
  if (limited) return NextResponse.json({ error: limited }, { status: 429 })

  const { data: run, error } = await supabase
    .from("sprint_ai_runs")
    .insert({ client_id: sprint.client_id, sprint_id: sprint.id, requested_by_profile_id: me.id })
    .select("id")
    .single()
  if (error || !run) return NextResponse.json({ error: "Couldn't start." }, { status: 500 })
  after(() => generateSprintPlan(run.id))
  return NextResponse.json({ runId: run.id })
}

/** Progress for the wine glass: stage, note and 0..1 progress. Read through RLS. */
export async function GET(request: Request) {
  await getProfile()
  const runId = new URL(request.url).searchParams.get("run")
  if (!runId) return NextResponse.json({ error: "Missing run." }, { status: 400 })
  const supabase = await createClient()
  const { data } = await supabase.from("sprint_ai_runs").select("status, stage, stage_note, progress, error").eq("id", runId).maybeSingle()
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 })
  return NextResponse.json({ ...data, progress: Number(data.progress) })
}
