"use server"

import { randomBytes } from "node:crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { canEdit, getProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { BOARD_KEYS } from "./boards"

// View-only report links for Notion (Dean, 2026-09-29). Admins, GTM leads and the client's account
// managers create and turn them off (checked here and by RLS). Never deleted.

const Create = z.object({
  board: z.enum(BOARD_KEYS as [string, ...string[]]),
  days: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(90)]),
  label: z.string().trim().max(120).optional(),
})

export async function createReportLink(slug: string, raw: z.input<typeof Create>): Promise<{ ok: boolean; message?: string }> {
  const me = await getProfile()
  if (!canEdit(me)) return { ok: false, message: "You have view access, so you can't share reports." }
  const p = Create.safeParse(raw)
  if (!p.success) return { ok: false, message: "Pick a board and a period." }
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle()
  if (!client) return { ok: false, message: "That client isn't available to you." }
  const { data: allowed } = await supabase.rpc("can_share_reports", { cid: client.id })
  if (!allowed) return { ok: false, message: "Only admins, GTM leads and the client's account managers can share reports." }
  const { error } = await supabase.from("report_links").insert({
    client_id: client.id,
    board: p.data.board,
    default_days: p.data.days,
    label: p.data.label || null,
    // 192 random bits: the link is the only key, so it must be unguessable.
    token: randomBytes(24).toString("base64url"),
    created_by_profile_id: me.id,
  })
  if (error) return { ok: false, message: "Couldn't create the link." }
  revalidatePath(`/clients/${slug}/reporting`)
  return { ok: true }
}

export async function turnOffReportLink(slug: string, id: string): Promise<{ ok: boolean; message?: string }> {
  const me = await getProfile()
  if (!canEdit(me) || !z.string().uuid().safeParse(id).success) return { ok: false, message: "Couldn't turn that link off." }
  const supabase = await createClient()
  const { data, error } = await supabase.from("report_links").update({ revoked_at: new Date().toISOString(), revoked_by_profile_id: me.id }).eq("id", id).is("revoked_at", null).select("id")
  if (error || !data?.length) return { ok: false, message: "Couldn't turn that link off." }
  revalidatePath(`/clients/${slug}/reporting`)
  return { ok: true }
}
