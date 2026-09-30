"use server"

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { canEdit, getProfile, isAdmin, VIEW_ONLY } from "@/lib/auth"
import { extractCall } from "@/lib/calls/extract"
import { notionIdFrom, resolveCallSource } from "@/lib/calls/notion"
import { londonToday } from "@/lib/checks/periods"
import { ensureSprint } from "@/lib/sprints/data"
import { sprintOf } from "@/lib/sprints/periods"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

// Client calls on the Brain tab and the follow-up pop-up. What the team does about an item is
// logged append-only as the signed-in user (RLS: the client's team, not viewers). Linking the
// source and adding notes by hand go through the server client after an access check. Notion is
// only ever read.

export type CallResult = { ok: boolean; message?: string; url?: string }
const fail = (message: string): CallResult => ({ ok: false, message })
const CONNECTED = ["linkedin", "google_ads", "meta"]

const refresh = (slug: string) => {
  revalidatePath(`/clients/${slug}/brain`)
  revalidatePath("/", "layout") // the pop-up
}

/** Link the Notion database or page that holds the client's call notes (read only). GTM leads and admins. */
export async function linkCallNotes(slug: string, link: string): Promise<CallResult> {
  const me = await getProfile()
  if (!isAdmin(me)) return fail("Only GTM leads and admins link call notes.")
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle()
  if (!client) return fail("This client isn't available to you.")
  const id = notionIdFrom(link)
  if (!id) return fail("Paste the link to the Notion page or database (Share → Copy link).")
  let src: Awaited<ReturnType<typeof resolveCallSource>>
  try {
    src = await resolveCallSource(id)
  } catch {
    return fail("Lumaux can't see that page. Check the link, and that it's shared with the Lumaux connection in Notion.")
  }
  const { error } = await createAdminClient().from("clients").update({ call_notes_notion_id: id, call_notes_kind: src.kind, call_notes_checked_at: null }).eq("id", client.id)
  if (error) return fail("Couldn't save.")
  refresh(slug)
  return { ok: true, message: `Linked "${src.title}". Reading the calls now.` }
}

const Manual = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the call's date."),
  title: z.string().trim().min(2, "Give the call a name.").max(200),
  text: z.string().trim().min(80, "Paste the notes (at least a few lines).").max(60_000),
})

/** Notes from a call that aren't in Notion (pasted by hand). Claude reads them straight away. */
export async function addManualCall(slug: string, raw: z.input<typeof Manual>): Promise<CallResult> {
  const me = await getProfile()
  if (!canEdit(me)) return fail(VIEW_ONLY)
  const p = Manual.safeParse(raw)
  if (!p.success) return fail(p.error.issues[0].message)
  if (p.data.date > londonToday()) return fail("That date is in the future.")
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle()
  if (!client) return fail("This client isn't available to you.")
  const { data: call, error } = await createAdminClient()
    .from("client_calls")
    .insert({ client_id: client.id, source: "manual", title: p.data.title, call_date: p.data.date, content: p.data.text, content_chars: p.data.text.length, synced_at: new Date().toISOString(), created_by_profile_id: me.id })
    .select("id")
    .single()
  if (error || !call) return fail("Couldn't save the notes.")
  after(() => extractCall(call.id))
  refresh(slug)
  return { ok: true, message: "Saved. Claude is reading them now (about half a minute)." }
}

/** Loads a follow-up through RLS: only people who can see the client get it. */
async function loadItem(id: string) {
  const supabase = await createClient()
  const { data } = await supabase.from("call_commitments").select("id, client_id, kind, title, detail, quote, platform, said_on, clients(slug), client_calls(title)").eq("id", id).maybeSingle()
  return { supabase, item: data }
}

const Act = z.object({
  action: z.enum(["done", "dropped", "snoozed", "reopened"]),
  reason: z.string().trim().max(500).optional(),
  days: z.number().int().min(1).max(60).optional(),
})

/** Done, not doing it (a reason), remind me later, or reopen. Everyone on the team sees the result. */
export async function actOnFollowUp(id: string, raw: z.input<typeof Act>): Promise<CallResult> {
  if (!canEdit(await getProfile())) return fail(VIEW_ONLY)
  const p = Act.safeParse(raw)
  if (!p.success) return fail(p.error.issues[0].message)
  if (p.data.action === "dropped" && !p.data.reason) return fail("Say why we're not doing it. It helps the next call.")
  const { supabase, item } = await loadItem(id)
  if (!item) return fail("This isn't available to you.")
  const snooze = p.data.action === "snoozed" ? new Date(Date.now() + (p.data.days ?? 7) * 86_400_000).toISOString().slice(0, 10) : null
  const me = await getProfile()
  const { error } = await supabase.from("call_commitment_actions").insert({ client_id: item.client_id, commitment_id: id, action: p.data.action, reason: p.data.reason || null, snooze_until: snooze, profile_id: me.id })
  if (error) return fail(error.message.includes("row-level security") ? VIEW_ONLY : "Couldn't save.")
  refresh((item.clients as unknown as { slug: string }).slug)
  return { ok: true }
}

/** Plan it as a test in the current sprint (Planned, no owner yet), linked back to the call. */
export async function planFollowUp(id: string): Promise<CallResult> {
  const me = await getProfile()
  if (!canEdit(me)) return fail(VIEW_ONLY)
  const { supabase, item } = await loadItem(id)
  if (!item) return fail("This isn't available to you.")
  const slug = (item.clients as unknown as { slug: string }).slug
  const callTitle = (item.client_calls as unknown as { title: string } | null)?.title ?? "a client call"
  const sprint = await ensureSprint(supabase, item.client_id, sprintOf(londonToday()))
  if (sprint.closed_at) return fail("This sprint is closed.")
  const notes = [`Said on "${callTitle}" (${item.said_on}).`, item.detail, item.quote ? `From the notes: "${item.quote}"` : null].filter(Boolean).join("\n\n")
  const { data: test, error } = await supabase
    .from("sprint_tests")
    .insert({
      sprint_id: sprint.id,
      client_id: item.client_id,
      platform: item.platform && CONNECTED.includes(item.platform) ? item.platform : null,
      title: item.title.slice(0, 200),
      assets: [],
      brief_notes: notes.slice(0, 3000),
      success_metric: "cost_per_result",
      created_by_profile_id: me.id,
      call_commitment_id: id, // lever: left for the person or Claude's nightly labels
    })
    .select("id")
    .single()
  if (error || !test) return fail("Couldn't create the test.")
  await supabase.from("call_commitment_actions").insert({ client_id: item.client_id, commitment_id: id, action: "planned", sprint_test_id: test.id, profile_id: me.id })
  refresh(slug)
  revalidatePath(`/clients/${slug}/sprint`)
  return { ok: true, message: `Planned in Sprint ${sprint.number}. Add the owner and success on the board.`, url: `/clients/${slug}/sprint#test-${test.id}` }
}
