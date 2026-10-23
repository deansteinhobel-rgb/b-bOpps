"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { briefBlocks } from "@/lib/campaign-brief/document"
import { notionChildren } from "@/lib/campaign-brief/notion"
import { brief as briefSchema, notionBriefTitle, totalAds } from "@/lib/campaign-brief/schema"
import { PRIORITIES } from "@/lib/notion/config"
import { writeDeps } from "@/lib/notion/server"
import { createNotionAction } from "@/lib/notion/write"
import { peopleForClient } from "@/lib/people"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type Result = { ok: true; message: string; url?: string } | { ok: false; message: string }

const Send = z.object({
  clientSlug: z.string().min(1).max(100),
  briefId: z.uuid(),
  // Notion IDs are UUID-shaped but not always RFC-valid, so check the shape only.
  ownerNotionId: z.string().regex(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  priority: z.enum(PRIORITIES).nullable(),
})

/**
 * "Send to Notion": one new Master Production page for the brief (Production Type Paid Media, Master
 * Status New, the brief as the page's content), through the one Notion write function: a dry run
 * unless Dean has switched writes on. One live page per brief.
 */
export async function sendBriefToNotion(raw: z.input<typeof Send>): Promise<Result> {
  const parsed = Send.safeParse(raw)
  if (!parsed.success) return { ok: false, message: "Pick a Project Lead." }
  const { clientSlug, briefId, ownerNotionId, dueDate, priority } = parsed.data
  const me = await getProfile()
  if (!canEdit(me)) return { ok: false, message: VIEW_ONLY }
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, name, notion_client_option").eq("slug", clientSlug).maybeSingle()
  if (!client) return { ok: false, message: "This client isn't available to you." }
  const { data: row } = await supabase.from("campaign_briefs").select("id, brief, created_at, notion_page_url, archived_at").eq("id", briefId).eq("client_id", client.id).maybeSingle()
  const b = briefSchema.safeParse(row?.brief)
  if (!row || row.archived_at || !b.success) return { ok: false, message: "This brief isn't ready to send." }
  if (row.notion_page_url) return { ok: false, message: "This brief is already in Notion." }
  const person = (await peopleForClient(supabase, client.id)).find((p) => p.notionUserId === ownerNotionId)
  if (!person) return { ok: false, message: "Pick a Project Lead." }
  const limited = await rateLimit(supabase, "notion_write")
  if (limited) return { ok: false, message: limited }

  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")
  const path = `/clients/${client.slug}/campaign-brief?brief=${row.id}`
  const blocks = briefBlocks(b.data, { clientName: client.name, createdOn: row.created_at.slice(0, 10), link: `${appUrl}${path}` })
  const res = await createNotionAction(writeDeps(), {
    client,
    title: notionBriefTitle(b.data),
    owner: { id: person.profileId ?? person.email, full_name: person.name, notion_user_id: person.notionUserId },
    priority,
    dueDate,
    description: `${b.data.summary} ${totalAds(b.data)} ads across ${b.data.channels.map((c) => c.platform).join(", ")}. Full brief below and in Lumaux: ${appUrl}${path}`,
    appLink: path,
    createdBy: { id: me.id, full_name: me.full_name, email: me.email },
    campaignBrief: { briefId: row.id, briefKey: `campaign:${row.id}`, children: notionChildren(blocks, `${appUrl}${path}`) },
  })
  if (res.status === "failed") return { ok: false, message: res.error }
  revalidatePath(`/clients/${client.slug}/campaign-brief`)
  return res.status === "created"
    ? { ok: true, message: "Sent to Master Production", url: res.page.url }
    : { ok: true, message: "Test mode: the brief was logged, nothing was sent to Notion" }
}

/** Archive a brief (nothing is ever deleted): it leaves the list; the row stays. */
export async function archiveBrief(raw: { clientSlug: string; briefId: string }): Promise<Result> {
  const parsed = z.object({ clientSlug: z.string().min(1).max(100), briefId: z.uuid() }).safeParse(raw)
  if (!parsed.success) return { ok: false, message: "Missing brief." }
  const me = await getProfile()
  if (!canEdit(me)) return { ok: false, message: VIEW_ONLY }
  const supabase = await createClient()
  const { data: row } = await supabase.from("campaign_briefs").select("id, client_id, clients!inner(slug)").eq("id", parsed.data.briefId).eq("clients.slug", parsed.data.clientSlug).maybeSingle()
  if (!row) return { ok: false, message: "This brief isn't available to you." }
  const { error } = await createAdminClient(me.id).from("campaign_briefs").update({ archived_at: new Date().toISOString(), archived_by: me.id }).eq("id", row.id).is("archived_at", null)
  if (error) return { ok: false, message: "Couldn't archive it. Try again." }
  revalidatePath(`/clients/${parsed.data.clientSlug}/campaign-brief`)
  return { ok: true, message: "Archived" }
}
