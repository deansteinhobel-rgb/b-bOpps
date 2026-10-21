import { after, NextResponse } from "next/server"
import { z } from "zod"
import { getProfile } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { canBuildCampaigns } from "@/lib/ads-api/access"
import { plan as planSchema, question, type Question } from "@/lib/campaign-builder/plan-schema"
import { runPlanner } from "@/lib/campaign-builder/planner"
import { presetByKey } from "@/lib/campaign-builder/presets"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { fromJson, toJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"

// A plan takes 1-2 minutes and runs after the response (see `after`), within this limit.
export const maxDuration = 300

const Start = z.object({
  slug: z.string().min(1).max(80),
  mode: z.enum(["general", "abx"]),
  preset: z.string().min(1).max(40),
  request: z.string().max(4000).default(""),
  proposal: z.string().max(40000).nullable().default(null),
  sprintTestId: z.uuid().nullable().default(null),
})
const Answer = z.object({ planId: z.uuid(), answers: z.record(z.string().max(40), z.string().max(2000)) })

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status })

/**
 * The campaign builder's planner (Dean, 2026-10-21). POST { slug, mode, preset, request, proposal? }
 * starts a plan; POST { planId, answers } plans again with the answers. Admins and GTM leads on the
 * client for now (canBuildCampaigns). Returns the plan id to poll with GET ?plan=.
 */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!aiConfigured()) return refuse("Claude isn't set up yet (ANTHROPIC_API_KEY).", 503)
  const body = await request.json().catch(() => ({}))
  const supabase = await createClient()

  const answer = Answer.safeParse(body)
  if (answer.success) {
    const { data: row } = await supabase.from("campaign_build_plans").select("id, client_id, mode, preset, request, proposal, sprint_test_id, answers, questions, plan, status").eq("id", answer.data.planId).maybeSingle()
    if (!row) return refuse("This plan isn't available to you.", 404)
    if (!(await canBuildCampaigns(me, row.client_id))) return refuse("Only admins and GTM leads on this client can build campaigns for now.", 403)
    if (row.status === "planning") return NextResponse.json({ planId: row.id })
    const limited = await rateLimit(supabase, "campaign_plan")
    if (limited) return refuse(limited, 429)
    const asked = fromJson<Question[]>(row.questions, [])
    const answers = { ...fromJson<Record<string, string>>(row.answers, {}), ...Object.fromEntries(Object.entries(answer.data.answers).filter(([k, v]) => v.trim() && asked.some((q) => q.id === k))) }
    const previous = planSchema.safeParse(row.plan)
    await createAdminClient(me.id).from("campaign_build_plans").update({ status: "planning", answers: toJson(answers), updated_at: new Date().toISOString() }).eq("id", row.id)
    after(() =>
      runPlanner(
        { planId: row.id, clientId: row.client_id, mode: row.mode as "general" | "abx", preset: row.preset, request: row.request, proposal: row.proposal, sprintTestId: row.sprint_test_id, answers, previous: previous.success ? previous.data : null, questionsAsked: asked.filter((q) => question.safeParse(q).success) },
        me.id,
      ),
    )
    return NextResponse.json({ planId: row.id })
  }

  const start = Start.safeParse(body)
  if (!start.success) return refuse("Missing or invalid fields.", 400)
  const s = start.data
  if (!presetByKey(s.preset)) return refuse("Unknown preset.", 400)
  const { data: client } = await supabase.from("clients").select("id").eq("slug", s.slug).maybeSingle()
  if (!client) return refuse("This client isn't available to you.", 404)
  if (!(await canBuildCampaigns(me, client.id))) return refuse("Only admins and GTM leads on this client can build campaigns for now.", 403)
  if (s.sprintTestId) {
    const { data: test } = await supabase.from("sprint_tests").select("id").eq("id", s.sprintTestId).eq("client_id", client.id).maybeSingle()
    if (!test) return refuse("That sprint test isn't this client's.", 400)
  }
  const limited = await rateLimit(supabase, "campaign_plan")
  if (limited) return refuse(limited, 429)

  const { data: row, error } = await createAdminClient(me.id)
    .from("campaign_build_plans")
    .insert({ client_id: client.id, platform: "linkedin", mode: s.mode, preset: s.preset, request: s.request, proposal: s.proposal?.trim() || null, sprint_test_id: s.sprintTestId, created_by: me.id })
    .select("id")
    .single()
  if (error || !row) return refuse("Couldn't start the plan.", 500)
  after(() => runPlanner({ planId: row.id, clientId: client.id, mode: s.mode, preset: s.preset, request: s.request, proposal: s.proposal, sprintTestId: s.sprintTestId, answers: {}, previous: null, questionsAsked: [] }, me.id))
  return NextResponse.json({ planId: row.id })
}

/** A plan's status, questions and plan, read through RLS. */
export async function GET(request: Request) {
  await getProfile()
  const planId = new URL(request.url).searchParams.get("plan")
  if (!planId || !z.uuid().safeParse(planId).success) return refuse("Missing plan.", 400)
  const supabase = await createClient()
  const { data } = await supabase.from("campaign_build_plans").select("id, status, questions, answers, plan, error, updated_at").eq("id", planId).maybeSingle()
  if (!data) return refuse("Not found.", 404)
  return NextResponse.json(data)
}
