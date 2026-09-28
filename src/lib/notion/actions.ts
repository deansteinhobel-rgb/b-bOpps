"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile } from "@/lib/auth"
import { peopleForClient } from "@/lib/people"
import { createClient } from "@/lib/supabase/server"
import { syncNotionMirror } from "./sync"
import { writeDeps } from "./server"
import { createNotionAction } from "./write"

const Input = z.object({
  clientSlug: z.string().min(1),
  title: z.string().trim().min(1, "Give the action a title.").max(200),
  // Notion IDs are UUID-shaped but not always RFC-valid, so check the shape only.
  ownerNotionId: z.string().regex(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i, "Pick an owner."),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  description: z.string().trim().max(10000).optional().default(""),
  checkResultId: z.string().uuid().nullable().optional(),
})

export type CreateActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "dry_run"; message: string; payload: unknown }
  | { status: "created"; message: string; url: string }

/**
 * Create an action in Notion (or, while testing, a dry run that only logs). Access is checked with
 * the user's own Supabase client (RLS); only then does the admin-side write function run.
 */
export async function createAction(raw: z.input<typeof Input>): Promise<CreateActionState> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." }
  const input = parsed.data
  const me = await getProfile()
  const supabase = await createClient()

  const { data: client } = await supabase.from("clients").select("id, slug, notion_client_option").eq("slug", input.clientSlug).maybeSingle()
  if (!client) return { status: "error", message: "This client isn't available to you." }
  // The owner must be someone on the team list (signed in or invited) with a Notion user.
  const person = (await peopleForClient(supabase, client.id)).find((p) => p.notionUserId === input.ownerNotionId)
  if (!person) return { status: "error", message: "Pick an owner." }
  const owner = { id: person.profileId ?? person.email, full_name: person.name, notion_user_id: person.notionUserId }

  if (input.checkResultId) {
    const { data: result } = await supabase.from("check_results").select("id, client_id, status, notion_action_page_id").eq("id", input.checkResultId).maybeSingle()
    if (!result || result.client_id !== client.id) return { status: "error", message: "That check isn't available to you." }
    if (result.notion_action_page_id) return { status: "error", message: "This check already has a Notion action." }
  }

  const res = await createNotionAction(writeDeps(), {
    client,
    title: input.title,
    owner,
    dueDate: input.dueDate ?? null,
    description: input.description,
    checkResultId: input.checkResultId ?? null,
    createdBy: { id: me.id, full_name: me.full_name, email: me.email },
  })

  revalidatePath(`/clients/${client.slug}/actions`)
  revalidatePath(`/clients/${client.slug}/checks`)
  if (res.status === "failed") return { status: "error", message: res.error }
  if (res.status === "dry_run") {
    return { status: "dry_run", message: "Test mode: nothing was sent to Notion. This is exactly what would have been created. It's saved in the write log.", payload: res.payload }
  }
  return { status: "created", message: "Action created in Notion.", url: res.page.url }
}

/** "Refresh from Notion": an incremental mirror sync (read-only). Any signed-in team member. */
export async function refreshFromNotion(clientSlug: string): Promise<{ ok: boolean; message: string }> {
  const me = await getProfile()
  if (!me.role) return { ok: false, message: "You don't have access yet." }
  try {
    const r = await syncNotionMirror()
    revalidatePath(`/clients/${clientSlug}`, "layout")
    return { ok: true, message: r.pages ? `Updated ${r.pages} page${r.pages === 1 ? "" : "s"} from Notion.` : "Already up to date." }
  } catch (e) {
    console.error("Refresh from Notion failed", e)
    return { ok: false, message: "Couldn't reach Notion. Try again in a minute." }
  }
}
