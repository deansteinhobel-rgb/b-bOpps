"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile, isAdmin } from "@/lib/auth"
import { peopleForClient } from "@/lib/people"
import { createClient } from "@/lib/supabase/server"

// Review → approve / reject for Claude's sprint suggestions. GTM leads and admins only (checked
// here and by RLS). Approving creates a planned test; nothing goes to Notion until someone clicks
// "Brief the team" on it, which stays behind the dry-run switches. Nothing is deleted.

export type AiResult = { ok: boolean; message?: string }
const fail = (message: string): AiResult => ({ ok: false, message })
const CONNECTED = ["linkedin", "google_ads", "meta"]
const OTHER_LABEL: Record<string, string> = { reddit: "Reddit Ads", bing: "Microsoft Ads (Bing)", x: "X Ads", chatgpt: "ChatGPT Ads" }

const Edit = z.object({
  title: z.string().trim().min(1, "Say what we're testing.").max(200),
  hypothesis: z.string().trim().max(1000),
  brief_notes: z.string().trim().max(3000),
  success_metric: z.string().max(40).nullable(),
  success_target: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().nonnegative().nullable()),
  success_text: z.string().trim().max(500),
})

async function load(id: string) {
  const me = await getProfile()
  if (!isAdmin(me)) return { error: "Only GTM leads and admins can review suggestions." as const }
  const supabase = await createClient()
  const { data: rec } = await supabase.from("sprint_recommendations").select("*, sprints(id, closed_at), clients(slug)").eq("id", id).maybeSingle()
  if (!rec) return { error: "This suggestion isn't available to you." as const }
  return { me, supabase, rec, slug: (rec.clients as { slug: string }).slug }
}
const refresh = (slug: string) => revalidatePath(`/clients/${slug}/sprint`)

/** Save edits and mark the suggestion reviewed. */
export async function reviewRecommendation(id: string, raw: z.input<typeof Edit>): Promise<AiResult> {
  const l = await load(id)
  if ("error" in l) return fail(l.error!)
  if (l.rec.status === "approved" || l.rec.status === "rejected") return fail("This suggestion has already been decided.")
  const p = Edit.safeParse(raw)
  if (!p.success) return fail(p.error.issues[0].message)
  const { error } = await l.supabase
    .from("sprint_recommendations")
    .update({ ...p.data, hypothesis: p.data.hypothesis || null, brief_notes: p.data.brief_notes || null, success_text: p.data.success_text || null, status: "reviewed", reviewed_by_profile_id: l.me.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return fail("Couldn't save.")
  refresh(l.slug)
  return { ok: true }
}

/** Approve a reviewed suggestion: it becomes a planned test in this sprint, with an owner and deadline. */
export async function approveRecommendation(id: string, raw: { owner_notion_user_id: string | null; deadline: string | null }): Promise<AiResult> {
  const l = await load(id)
  if ("error" in l) return fail(l.error!)
  const r = l.rec
  if (r.status !== "reviewed") return fail(r.status === "draft" ? "Review it first." : "This suggestion has already been decided.")
  const sprint = r.sprints as { id: string; closed_at: string | null }
  if (sprint.closed_at) return fail("This sprint is closed.")
  if (raw.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(raw.deadline)) return fail("Pick a valid deadline.")
  if (!r.success_text && (r.success_metric === null || r.success_target === null)) return fail("Say what success looks like: a target, or a sentence.")
  const owner = raw.owner_notion_user_id ? (await peopleForClient(l.supabase, r.client_id)).find((x) => x.notionUserId === raw.owner_notion_user_id) : null

  // Platforms we don't have connected are planned as "several", with the platform named in the title.
  const connected = CONNECTED.includes(r.platform)
  const title = connected || r.platform === "several" ? r.title : `${OTHER_LABEL[r.platform] ?? r.platform}: ${r.title}`
  const notes = [r.brief_notes, r.why_data && `Why (our data): ${r.why_data}`, r.why_market && `Why (market): ${r.why_market}`, !connected && r.platform !== "several" && "Not connected to Windsor: track results by hand."]
    .filter(Boolean)
    .join("\n\n")
  const { data: test, error } = await l.supabase
    .from("sprint_tests")
    .insert({
      sprint_id: r.sprint_id,
      client_id: r.client_id,
      platform: connected ? r.platform : null,
      title: title.slice(0, 200),
      hypothesis: r.hypothesis,
      assets: r.assets,
      brief_notes: notes.slice(0, 3000) || null,
      success_metric: r.success_target === null ? null : r.success_metric,
      success_target: r.success_target,
      success_text: r.success_text,
      owner_notion_user_id: owner?.notionUserId ?? null,
      owner_name: owner?.name ?? null,
      deadline: raw.deadline,
      created_by_profile_id: l.me.id,
    })
    .select("id")
    .single()
  if (error || !test) return fail("Couldn't create the test.")
  await l.supabase
    .from("sprint_recommendations")
    .update({ status: "approved", decided_by_profile_id: l.me.id, decided_at: new Date().toISOString(), sprint_test_id: test.id, updated_at: new Date().toISOString() })
    .eq("id", id)
  refresh(l.slug)
  return { ok: true }
}

/** Reject with a reason. Claude reads the reasons next time. */
export async function rejectRecommendation(id: string, reason: string): Promise<AiResult> {
  const l = await load(id)
  if ("error" in l) return fail(l.error!)
  if (l.rec.status === "approved" || l.rec.status === "rejected") return fail("This suggestion has already been decided.")
  const why = reason.trim().slice(0, 500)
  if (!why) return fail("Say why, in a line. Claude learns from it.")
  const { error } = await l.supabase
    .from("sprint_recommendations")
    .update({ status: "rejected", reject_reason: why, decided_by_profile_id: l.me.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return fail("Couldn't save.")
  refresh(l.slug)
  return { ok: true }
}
