"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile, isAdmin } from "@/lib/auth"
import { postToSlack } from "@/lib/slack"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

export type OptionsResult = { ok: boolean; message?: string }
const fail = (message: string): OptionsResult => ({ ok: false, message })

const Prefs = z.object({
  default_days: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(90)]),
  optimise_order: z.enum(["claude", "priority"]),
  start_page: z.string().regex(/^[a-z0-9-]+$/).max(80),
  animations: z.boolean(),
})

/** Save your preferences (profiles.preferences, your own row only). */
export async function savePreferences(raw: z.input<typeof Prefs>): Promise<OptionsResult> {
  const p = Prefs.safeParse(raw)
  if (!p.success) return fail("Check your choices.")
  const me = await getProfile()
  const supabase = await createClient()
  const { error } = await supabase.from("profiles").update({ preferences: { ...me.preferences, ...p.data } }).eq("id", me.id)
  if (error) return fail("Couldn't save.")
  revalidatePath("/", "layout")
  return { ok: true }
}

const Feedback = z.object({
  kind: z.enum(["feature", "bug"]),
  title: z.string().trim().min(3, "Give it a short title.").max(160),
  details: z.string().trim().max(5000),
  page_url: z.string().trim().max(500),
})

/** Suggest a feature or report a bug. Admins see it in Admin → Feedback (and Slack once it's set up). */
export async function sendFeedback(raw: z.input<typeof Feedback>): Promise<OptionsResult> {
  const p = Feedback.safeParse(raw)
  if (!p.success) return fail(p.error.issues[0].message)
  const me = await getProfile()
  const supabase = await createClient()
  const limited = await rateLimit(supabase, "feedback")
  if (limited) return fail(limited)
  const { error } = await supabase.from("feedback").insert({ profile_id: me.id, kind: p.data.kind, title: p.data.title, details: p.data.details || null, page_url: p.data.page_url || null })
  if (error) return fail("Couldn't send it.")
  await postToSlack(`${p.data.kind === "bug" ? "Bug report" : "Feature idea"} from ${me.full_name ?? me.email}: ${p.data.title}`).catch(() => {})
  revalidatePath("/options")
  revalidatePath("/admin/feedback")
  return { ok: true }
}

const Triage = z.object({ status: z.enum(["new", "planned", "in_progress", "done", "wont_do"]), admin_note: z.string().trim().max(1000) })

/** Admins: set a suggestion's status and a note the sender sees. */
export async function triageFeedback(id: string, raw: z.input<typeof Triage>): Promise<OptionsResult> {
  const me = await getProfile()
  if (!isAdmin(me)) return fail("Admins only.")
  const p = Triage.safeParse(raw)
  if (!p.success) return fail("Check the status.")
  const supabase = await createClient()
  const { error } = await supabase.from("feedback").update({ status: p.data.status, admin_note: p.data.admin_note || null, updated_at: new Date().toISOString() }).eq("id", id)
  if (error) return fail("Couldn't save.")
  revalidatePath("/admin/feedback")
  revalidatePath("/options")
  return { ok: true }
}
