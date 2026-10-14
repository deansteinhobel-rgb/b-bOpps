"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

/**
 * The sequence builder's edits (Plan › Content library). All through the user's own Supabase client,
 * so RLS and the guard triggers apply: the client's team edits, viewers can't, Claude's pick and the
 * approval stay with the server. Changing an approved sequence sends it back for approval (a trigger).
 */

type Result = { ok: true; message?: string } | { ok: false; message: string }

const Slot = z.union([z.literal(1), z.literal(2), z.literal(3)])
const Id = z.string().uuid()
const Base = z.object({ clientSlug: z.string().min(1).max(100), pieceId: Id })

/** The piece, loaded through RLS and checked against the client in the URL. */
async function pieceFor(clientSlug: string, pieceId: string) {
  const me = await getProfile()
  if (!canEdit(me)) return { error: VIEW_ONLY } as const
  const supabase = await createClient()
  const { data: piece } = await supabase.from("content_pieces").select("id, client_id, seq_status, clients!inner(slug)").eq("id", pieceId).eq("clients.slug", clientSlug).maybeSingle()
  if (!piece) return { error: "That piece isn't in this client's library." } as const
  return { me, supabase, piece } as const
}

const done = (clientSlug: string, message?: string): Result => {
  revalidatePath(`/clients/${clientSlug}/library`)
  return { ok: true, message }
}

const SetEmail = Base.extend({ slot: Slot, target: z.union([Id, z.literal("handoff"), z.null()]) })

/**
 * Choose what an email sends: another piece, the sales handoff, or nothing. Picking Claude's own
 * choice again brings back Claude's angle; anything else clears the angle so nobody sends an email
 * with the hook written for a different piece.
 */
export async function setEmail(raw: z.input<typeof SetEmail>): Promise<Result> {
  const parsed = SetEmail.safeParse(raw)
  if (!parsed.success) return { ok: false, message: "Pick a piece for this email." }
  const { clientSlug, pieceId, slot, target } = parsed.data
  if (target === pieceId) return { ok: false, message: "A piece can't be a follow-up to itself." }
  const ctx = await pieceFor(clientSlug, pieceId)
  if ("error" in ctx) return { ok: false, message: ctx.error! }
  const { me, supabase, piece } = ctx

  const { data: cur } = await supabase.from("content_sequences").select("suggested_target_piece_id, suggested_handoff, suggested_angle").eq("piece_id", pieceId).eq("slot", slot).maybeSingle()
  const handoff = target === "handoff"
  const targetId = handoff ? null : target
  const backToClaude = Boolean(cur) && (cur!.suggested_target_piece_id !== null || cur!.suggested_handoff !== null) && cur!.suggested_target_piece_id === targetId && Boolean(cur!.suggested_handoff) === handoff
  const values = { target_piece_id: targetId, handoff, angle: backToClaude ? cur!.suggested_angle : null, updated_by_profile_id: me.id }

  const { error } = cur
    ? await supabase.from("content_sequences").update(values).eq("piece_id", pieceId).eq("slot", slot)
    : await supabase.from("content_sequences").insert({ piece_id: pieceId, slot, client_id: piece.client_id, ...values })
  if (error) return { ok: false, message: error.message.includes("same client") ? "A sequence can only send this client's content." : "Couldn't save the email." }
  return done(clientSlug, backToClaude ? "Back to Claude's pick" : "Email updated")
}

const SetAngle = Base.extend({ slot: Slot, angle: z.string().max(300) })

/** The hook a copywriter turns into the email. Saved when the field loses focus. */
export async function setAngle(raw: z.input<typeof SetAngle>): Promise<Result> {
  const parsed = SetAngle.safeParse(raw)
  if (!parsed.success) return { ok: false, message: "Keep the angle under 300 characters." }
  const { clientSlug, pieceId, slot } = parsed.data
  const angle = parsed.data.angle.replace(/\s+/g, " ").trim() || null
  const ctx = await pieceFor(clientSlug, pieceId)
  if ("error" in ctx) return { ok: false, message: ctx.error! }
  const { me, supabase, piece } = ctx
  const { data: cur } = await supabase.from("content_sequences").select("angle").eq("piece_id", pieceId).eq("slot", slot).maybeSingle()
  if (cur && (cur.angle ?? null) === angle) return { ok: true }
  const { error } = cur
    ? await supabase.from("content_sequences").update({ angle, updated_by_profile_id: me.id }).eq("piece_id", pieceId).eq("slot", slot)
    : await supabase.from("content_sequences").insert({ piece_id: pieceId, slot, client_id: piece.client_id, angle, updated_by_profile_id: me.id })
  if (error) return { ok: false, message: "Couldn't save the angle." }
  return done(clientSlug, "Angle saved")
}

const Revert = Base.extend({ slot: Slot })

/** Put an email back to Claude's pick: its piece (or the handoff) and its angle. */
export async function revertToClaude(raw: z.input<typeof Revert>): Promise<Result> {
  const parsed = Revert.safeParse(raw)
  if (!parsed.success) return { ok: false, message: "Couldn't find that email." }
  const { clientSlug, pieceId, slot } = parsed.data
  const ctx = await pieceFor(clientSlug, pieceId)
  if ("error" in ctx) return { ok: false, message: ctx.error! }
  const { me, supabase } = ctx
  const { data: cur } = await supabase.from("content_sequences").select("suggested_target_piece_id, suggested_handoff, suggested_angle").eq("piece_id", pieceId).eq("slot", slot).maybeSingle()
  if (!cur || (cur.suggested_target_piece_id === null && cur.suggested_handoff === null)) return { ok: false, message: "Claude hasn't picked anything for this email." }
  const { error } = await supabase
    .from("content_sequences")
    .update({ target_piece_id: cur.suggested_target_piece_id, handoff: Boolean(cur.suggested_handoff), angle: cur.suggested_angle, updated_by_profile_id: me.id })
    .eq("piece_id", pieceId)
    .eq("slot", slot)
  if (error) return { ok: false, message: "Couldn't revert the email." }
  return done(clientSlug, "Back to Claude's pick")
}

const NotRequired = Base.extend({ notRequired: z.boolean() })

/**
 * Mark a piece's sequence as not required (e.g. a Decision-stage page that hands straight to sales),
 * or undo that. Approving is separate: it sends the brief to Notion first.
 */
export async function setNotRequired(raw: z.input<typeof NotRequired>): Promise<Result> {
  const parsed = NotRequired.safeParse(raw)
  if (!parsed.success) return { ok: false, message: "Couldn't update the sequence." }
  const { clientSlug, pieceId, notRequired } = parsed.data
  const ctx = await pieceFor(clientSlug, pieceId)
  if ("error" in ctx) return { ok: false, message: ctx.error! }
  const { me, supabase, piece } = ctx
  if (notRequired && piece.seq_status === "approved") return { ok: false, message: "This sequence is approved and briefed. Change an email to reopen it first." }
  const { error } = await supabase
    .from("content_pieces")
    .update({ seq_status: notRequired ? "not_required" : "pending", updated_by_profile_id: me.id })
    .eq("id", pieceId)
  if (error) return { ok: false, message: "Couldn't update the sequence." }
  return done(clientSlug, notRequired ? "Marked not required. You can approve it any time" : "Back to awaiting approval")
}
