import { after, NextResponse } from "next/server"
import { z } from "zod"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { runAsk, runWrite } from "@/lib/campaign-brief/generate"
import type { BriefQuestion } from "@/lib/campaign-brief/schema"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { fromJson, toJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"

// Each step takes 20 seconds to 2 minutes and runs after the response (see `after`), within this limit.
export const maxDuration = 300

const Start = z.object({ slug: z.string().min(1).max(80), request: z.string().trim().min(3).max(4000), notes: z.string().max(20000).default("") })
const Answer = z.object({ briefId: z.uuid(), answers: z.record(z.string().max(40), z.string().max(2000)) })
const Revise = z.object({ briefId: z.uuid(), revision: z.string().trim().min(3).max(4000) })

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status })
// A run that hasn't moved for 10 minutes counts as stuck, so it can be started again.
const busy = (row: { status: string; updated_at: string }) => (row.status === "asking" || row.status === "writing") && Date.now() - Date.parse(row.updated_at) < 10 * 60_000

/**
 * Planning › Generate a campaign brief (Dean, 2026-10-23). Anyone who can edit the client.
 *   POST { slug, request, notes? } starts a brief: Claude asks its questions first.
 *   POST { briefId, answers } writes the brief from the answers (also "Try again" after a failure).
 *   POST { briefId, revision } rewrites a ready brief with the change asked for.
 * Returns the brief id to poll with GET ?brief=.
 */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!canEdit(me)) return refuse(VIEW_ONLY, 403)
  if (!aiConfigured()) return refuse("Claude isn't set up yet (ANTHROPIC_API_KEY).", 503)
  const body = await request.json().catch(() => ({}))
  const supabase = await createClient()

  const answer = Answer.safeParse(body)
  const revise = Revise.safeParse(body)
  if (answer.success || revise.success) {
    const briefId = answer.success ? answer.data.briefId : revise.data!.briefId
    const { data: row } = await supabase.from("campaign_briefs").select("id, status, questions, answers, brief, updated_at, archived_at").eq("id", briefId).maybeSingle()
    if (!row || row.archived_at) return refuse("This brief isn't available to you.", 404)
    if (busy(row)) return NextResponse.json({ briefId: row.id })
    if (revise.success && !row.brief) return refuse("There's no brief to change yet.", 400)
    const limited = await rateLimit(supabase, "campaign_brief")
    if (limited) return refuse(limited, 429)
    const asked = fromJson<BriefQuestion[]>(row.questions, [])
    const given = answer.success ? Object.entries(answer.data.answers).filter(([k, v]) => v.trim() && asked.some((q) => q.id === k)) : []
    await createAdminClient(me.id)
      .from("campaign_briefs")
      .update({
        status: "writing",
        error: null,
        updated_at: new Date().toISOString(),
        ...(answer.success ? { answers: toJson({ ...fromJson<Record<string, string>>(row.answers, {}), ...Object.fromEntries(given) }), revision: null } : { revision: revise.data!.revision }),
      })
      .eq("id", row.id)
    // A brief that failed before its questions came back asks again; otherwise it writes.
    after(() => (asked.length || row.brief ? runWrite(row.id, me.id) : runAsk(row.id, me.id)))
    return NextResponse.json({ briefId: row.id })
  }

  const start = Start.safeParse(body)
  if (!start.success) return refuse("Say what the campaign is for (at least a few words).", 400)
  const { data: client } = await supabase.from("clients").select("id").eq("slug", start.data.slug).maybeSingle()
  if (!client) return refuse("This client isn't available to you.", 404)
  const limited = await rateLimit(supabase, "campaign_brief")
  if (limited) return refuse(limited, 429)
  const { data: row, error } = await createAdminClient(me.id)
    .from("campaign_briefs")
    .insert({ client_id: client.id, request: start.data.request, notes: start.data.notes.trim() || null, created_by: me.id })
    .select("id")
    .single()
  if (error || !row) return refuse("Couldn't start the brief.", 500)
  after(() => runAsk(row.id, me.id))
  return NextResponse.json({ briefId: row.id })
}

/** A brief's status, questions and brief, read through RLS. */
export async function GET(request: Request) {
  await getProfile()
  const briefId = new URL(request.url).searchParams.get("brief")
  if (!briefId || !z.uuid().safeParse(briefId).success) return refuse("Missing brief.", 400)
  const supabase = await createClient()
  const { data } = await supabase.from("campaign_briefs").select("id, status, questions, answers, brief, error, updated_at").eq("id", briefId).maybeSingle()
  if (!data) return refuse("Not found.", 404)
  return NextResponse.json(data)
}
