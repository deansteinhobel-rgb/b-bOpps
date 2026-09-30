"use server"

import { randomBytes } from "node:crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { canEdit, getProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { decodeRange, encodeRange } from "@/lib/metrics/range"
import { BOARD_KEYS } from "./boards"

// View-only report links for Notion (Dean, 2026-09-29). Admins, GTM leads and the client's account
// managers create and turn them off (checked here and by RLS). Never deleted.

const Create = z.object({
  board: z.enum(BOARD_KEYS as [string, ...string[]]),
  // A quick period ("30"), a preset ("qtd") or fixed dates ("2026-07-01..2026-09-30").
  opens: z.string().max(30).refine((v) => decodeRange(v) !== null),
  label: z.string().trim().max(120).optional(),
})

export async function createReportLink(slug: string, raw: z.input<typeof Create>): Promise<{ ok: boolean; message?: string }> {
  const me = await getProfile()
  if (!canEdit(me)) return { ok: false, message: "You have view access, so you can't share reports." }
  const p = Create.safeParse(raw)
  if (!p.success) return { ok: false, message: "Pick a board and the dates it opens on." }
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle()
  if (!client) return { ok: false, message: "That client isn't available to you." }
  const { data: allowed } = await supabase.rpc("can_share_reports", { cid: client.id })
  if (!allowed) return { ok: false, message: "Only admins, GTM leads and the client's account managers can share reports." }
  const opens = decodeRange(p.data.opens)!
  const { error } = await supabase.from("report_links").insert({
    client_id: client.id,
    board: p.data.board,
    default_days: opens.kind === "days" ? opens.days : 30,
    default_range: opens.kind === "days" ? null : encodeRange(opens),
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
