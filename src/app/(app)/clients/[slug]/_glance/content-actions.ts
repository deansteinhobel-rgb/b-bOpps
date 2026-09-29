"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { peopleForClient } from "@/lib/people"
import { ensureSprint } from "@/lib/sprints/data"
import { sprintOf } from "@/lib/sprints/periods"
import { createClient } from "@/lib/supabase/server"

// What the team does with a content idea (Dean, 2026-09-29): plan it as a sprint test, or say it's
// not for us (with a reason Claude reads next time). As the signed-in user (RLS: the client's team),
// logged append-only in content_idea_actions. Nothing goes to Notion from here: "Brief the team" on
// the planned test does that, dry run by default.

type Result = { ok: boolean; message?: string; url?: string }
const fail = (message: string): Result => ({ ok: false, message })
type Idea = { id: string; title: string; kind: string; content_type: string; topic: string; platform: string; format: string; audience: string; audience_basis: string; built_on: { ref: string; what: string }[]; evidence: string; why_it_fits: string; hook: string; success: string }

async function load(slug: string, runId: string, ideaId: string) {
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle()
  if (!client) return null
  const { data: run } = await supabase.from("content_idea_runs").select("id, ideas").eq("id", runId).eq("client_id", client.id).maybeSingle()
  const idea = ((run?.ideas ?? []) as Idea[]).find((i) => i.id === ideaId)
  return run && idea ? { supabase, clientId: client.id as string, run, idea } : null
}

const Plan = z.object({
  title: z.string().trim().min(1, "Say what we're testing.").max(200),
  success_text: z.string().trim().min(1, "Say what success looks like.").max(500),
  owner_notion_user_id: z.string().max(60).nullable(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
})

/** Plan a content idea as a test in the current sprint, with the idea written into the brief notes. */
export async function planContentIdea(slug: string, runId: string, ideaId: string, raw: z.input<typeof Plan>): Promise<Result> {
  const me = await getProfile()
  if (!canEdit(me)) return fail(VIEW_ONLY)
  const p = Plan.safeParse(raw)
  if (!p.success) return fail(p.error.issues[0].message)
  const l = await load(slug, runId, ideaId)
  if (!l) return fail("That idea isn't available any more.")
  const sprint = await ensureSprint(l.supabase, l.clientId, sprintOf(londonToday()))
  if (sprint.closed_at) return fail("This sprint is closed.")
  const owner = p.data.owner_notion_user_id ? (await peopleForClient(l.supabase, l.clientId)).find((x) => x.notionUserId === p.data.owner_notion_user_id) : null
  const i = l.idea
  const notes = [
    `From a content idea (At a glance): ${i.content_type}, ${i.format}.`,
    `What: ${i.topic}`,
    `Audience (${i.audience_basis === "new" ? "new" : "one that already ran"}): ${i.audience}`,
    `Angle: ${i.hook}`,
    `Why it fits: ${i.why_it_fits}`,
    `Evidence: ${i.evidence}`,
    i.built_on.length ? `Built on:\n${i.built_on.map((b) => `- ${b.ref}: ${b.what}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")
  const { data: test, error } = await l.supabase
    .from("sprint_tests")
    .insert({
      sprint_id: sprint.id,
      client_id: l.clientId,
      platform: ["linkedin", "google_ads", "meta"].includes(i.platform) ? i.platform : null,
      title: p.data.title,
      hypothesis: `${i.content_type} for ${i.audience}: ${i.hook}`.slice(0, 1000),
      assets: [`${i.content_type}: ${i.topic}`.slice(0, 200)],
      brief_notes: notes.slice(0, 3000),
      success_text: p.data.success_text,
      owner_notion_user_id: owner?.notionUserId ?? null,
      owner_name: owner?.name ?? null,
      deadline: p.data.deadline,
      created_by_profile_id: me.id,
      content_idea_id: i.id,
    })
    .select("id")
    .single()
  if (error || !test) return fail("Couldn't create the test.")
  await l.supabase.from("content_idea_actions").insert({ client_id: l.clientId, run_id: runId, idea_id: i.id, action: "planned", sprint_test_id: test.id, snapshot: i, profile_id: me.id })
  revalidatePath(`/clients/${slug}`)
  revalidatePath(`/clients/${slug}/sprint`)
  return { ok: true, message: `Planned in Sprint ${sprint.number}.`, url: `/clients/${slug}/sprint#test-${test.id}` }
}

/** Not for us (the reason is what Claude learns from), or bring an idea back. */
export async function markContentIdea(slug: string, runId: string, ideaId: string, action: "dismissed" | "reopened", reason: string): Promise<Result> {
  const me = await getProfile()
  if (!canEdit(me)) return fail(VIEW_ONLY)
  const r = z.string().trim().max(500).safeParse(reason)
  if (!r.success) return fail("Keep the reason under 500 characters.")
  if (action === "dismissed" && !r.data) return fail("Say why, so Claude learns from it.")
  const l = await load(slug, runId, ideaId)
  if (!l) return fail("That idea isn't available any more.")
  const { error } = await l.supabase.from("content_idea_actions").insert({ client_id: l.clientId, run_id: runId, idea_id: ideaId, action, reason: r.data || null, snapshot: l.idea, profile_id: me.id })
  if (error) return fail("Couldn't save that.")
  revalidatePath(`/clients/${slug}`)
  return { ok: true }
}
