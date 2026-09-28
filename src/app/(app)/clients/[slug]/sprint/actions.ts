"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile, isAdmin } from "@/lib/auth"
import { carryForward, cachedSprintNumbers, type Sprint } from "@/lib/sprints/data"
import { sprintByNumber } from "@/lib/sprints/periods"
import { createClient } from "@/lib/supabase/server"

// Everything runs as the signed-in user: RLS limits it to the client's team (and admins).
// Nothing is ever deleted: items are "dropped", changes "dismissed". Closed sprints are read-only.

export type Result = { ok: boolean; message?: string }
const fail = (message: string): Result => ({ ok: false, message })

async function openSprint(sprintId: string) {
  const supabase = await createClient()
  const { data } = await supabase.from("sprints").select("id, client_id, number, closed_at, clients(slug)").eq("id", sprintId).maybeSingle()
  if (!data) return { supabase, sprint: null, error: "This sprint isn't available to you." }
  if (data.closed_at) return { supabase, sprint: null, error: "This sprint is closed. An admin can reopen it." }
  return { supabase, sprint: data as unknown as { id: string; client_id: string; number: number; clients: { slug: string } }, error: null }
}
const refresh = (slug: string) => revalidatePath(`/clients/${slug}/sprint`)

const TEXT_FIELDS = ["goal", "key_takeaway", "highlights", "challenges", "progress_made"] as const

export async function saveSprintText(sprintId: string, field: (typeof TEXT_FIELDS)[number], value: string): Promise<Result> {
  if (!TEXT_FIELDS.includes(field)) return fail("Unknown field.")
  const { supabase, sprint, error } = await openSprint(sprintId)
  if (!sprint) return fail(error!)
  const { error: e } = await supabase.from("sprints").update({ [field]: value.trim().slice(0, 5000) || null }).eq("id", sprintId)
  if (e) return fail("Couldn't save.")
  refresh(sprint.clients.slug)
  return { ok: true }
}

const Kind = z.enum(["hypothesis", "learning", "mitigation", "action"])

export async function addItem(sprintId: string, kind: z.infer<typeof Kind>, text: string): Promise<Result> {
  if (!Kind.safeParse(kind).success) return fail("Unknown item type.")
  const clean = text.trim().slice(0, 1000)
  if (!clean) return fail("Write something first.")
  const me = await getProfile()
  const { supabase, sprint, error } = await openSprint(sprintId)
  if (!sprint) return fail(error!)
  // Learnings and mitigations are carried forward by default: that's the point of the loop.
  const { error: e } = await supabase.from("sprint_items").insert({
    sprint_id: sprintId,
    client_id: sprint.client_id,
    kind,
    text: clean,
    carry_forward: kind === "learning" || kind === "mitigation",
    created_by_profile_id: me.id,
  })
  if (e) return fail("Couldn't add it.")
  refresh(sprint.clients.slug)
  return { ok: true }
}

const ItemPatch = z.object({
  status: z.enum(["open", "done", "dropped"]).optional(),
  outcome: z.enum(["proven", "disproven", "inconclusive"]).nullable().optional(),
  carry_forward: z.boolean().optional(),
})

export async function updateItem(itemId: string, patch: z.infer<typeof ItemPatch>): Promise<Result> {
  const parsed = ItemPatch.safeParse(patch)
  if (!parsed.success) return fail("Invalid change.")
  const supabase = await createClient()
  const { data: item } = await supabase.from("sprint_items").select("sprint_id").eq("id", itemId).maybeSingle()
  if (!item) return fail("That item isn't available to you.")
  const { sprint, error } = await openSprint(item.sprint_id)
  if (!sprint) return fail(error!)
  const { error: e } = await supabase.from("sprint_items").update(parsed.data).eq("id", itemId)
  if (e) return fail("Couldn't save.")
  refresh(sprint.clients.slug)
  return { ok: true }
}

const Change = z.object({
  changed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  platform: z.enum(["linkedin", "google_ads", "meta"]).nullable(),
  campaign_name: z.string().trim().max(300).nullable(),
  type: z.enum(["budget", "creative", "targeting", "bidding", "landing_page", "tracking", "structure", "other"]),
  description: z.string().trim().min(1, "Describe the change.").max(2000),
  hypothesis_item_id: z.string().uuid().nullable(),
  detected_key: z.string().max(500).nullable().optional(),
  status: z.enum(["logged", "dismissed"]).optional(),
})

export async function logChange(sprintId: string, input: z.input<typeof Change>): Promise<Result> {
  const parsed = Change.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0].message)
  const me = await getProfile()
  const { supabase, sprint, error } = await openSprint(sprintId)
  if (!sprint) return fail(error!)
  const { detected_key, status, ...rest } = parsed.data
  const row = {
    ...rest,
    campaign_name: rest.campaign_name || null,
    sprint_id: sprintId,
    client_id: sprint.client_id,
    source: detected_key ? "detected" : "manual",
    detected_key: detected_key ?? null,
    status: status ?? "logged",
    created_by_profile_id: me.id,
  }
  const { error: e } = detected_key
    ? await supabase.from("sprint_changes").upsert(row, { onConflict: "client_id,detected_key" })
    : await supabase.from("sprint_changes").insert(row)
  if (e) return fail("Couldn't save the change.")
  refresh(sprint.clients.slug)
  return { ok: true }
}

export async function setChangeStatus(changeId: string, status: "logged" | "dismissed"): Promise<Result> {
  const supabase = await createClient()
  const { data: change } = await supabase.from("sprint_changes").select("sprint_id").eq("id", changeId).maybeSingle()
  if (!change) return fail("That change isn't available to you.")
  const { sprint, error } = await openSprint(change.sprint_id)
  if (!sprint) return fail(error!)
  await supabase.from("sprint_changes").update({ status }).eq("id", changeId)
  refresh(sprint.clients.slug)
  return { ok: true }
}

/** Close: needs a key takeaway. Snapshots the numbers, then carries the chosen items into the next sprint if it exists. */
export async function closeSprint(sprintId: string): Promise<Result> {
  const me = await getProfile()
  const { supabase, sprint, error } = await openSprint(sprintId)
  if (!sprint) return fail(error!)
  const { data: full } = await supabase.from("sprints").select("*").eq("id", sprintId).single()
  if (!(full as Sprint).key_takeaway?.trim()) return fail("Add the key takeaway before closing the sprint.")
  const period = sprintByNumber(sprint.number)
  const { summary } = await cachedSprintNumbers(sprint.client_id, period) // access confirmed by openSprint (RLS)
  const { error: e } = await supabase.from("sprints").update({ summary, closed_at: new Date().toISOString(), closed_by_profile_id: me.id }).eq("id", sprintId)
  if (e) return fail("Couldn't close the sprint.")
  const next = sprintByNumber(sprint.number + 1)
  const { data: nextSprint } = await supabase.from("sprints").select("id, client_id").eq("client_id", sprint.client_id).eq("start_date", next.start).maybeSingle()
  if (nextSprint) await carryForward(supabase, { id: sprint.id, number: sprint.number }, nextSprint)
  refresh(sprint.clients.slug)
  return { ok: true, message: "Sprint closed. Chosen items carry into the next sprint." }
}

export async function reopenSprint(sprintId: string): Promise<Result> {
  const me = await getProfile()
  if (!isAdmin(me)) return fail("Only admins can reopen a sprint.")
  const supabase = await createClient()
  const { data } = await supabase.from("sprints").select("clients(slug)").eq("id", sprintId).maybeSingle()
  if (!data) return fail("This sprint isn't available to you.")
  await supabase.from("sprints").update({ closed_at: null, closed_by_profile_id: null }).eq("id", sprintId)
  refresh((data.clients as unknown as { slug: string }).slug)
  return { ok: true }
}
