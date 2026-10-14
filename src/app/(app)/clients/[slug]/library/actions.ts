"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { verifySuggestion } from "@/lib/content-library/claude"
import { sequenceBriefText, sequenceBriefTitle } from "@/lib/content-library/brief"
import { libraryConfig, nextCode, notionVertical, STAGES } from "@/lib/content-library/config"
import { loadLibrary } from "@/lib/content-library/load"
import { codesFor } from "@/lib/content-library/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { writeDeps } from "@/lib/notion/server"
import { createNotionAction } from "@/lib/notion/write"
import { peopleForClient } from "@/lib/people"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

/**
 * The sequence builder's edits (Plan › Content library). All through the user's own Supabase client,
 * so RLS and the guard triggers apply: the client's team edits, viewers can't, Claude's pick and the
 * approval stay with the server. Changing an approved sequence sends it back for approval (a trigger).
 */

/** `needsAngle`: the email now sends something new, so the page asks Claude for its angle. */
type Result = { ok: true; message?: string; needsAngle?: boolean } | { ok: false; message: string }

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

const done = (clientSlug: string, message?: string): { ok: true; message?: string } => {
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
  if (target === "handoff" && slot !== 3) return { ok: false, message: "The sales handoff can only be email 3." }
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
  return { ...done(clientSlug, backToClaude ? "Back to Claude's pick" : "Email updated"), needsAngle: !backToClaude && target !== null }
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

const Email = z.object({ slot: Slot, target: z.union([Id, z.literal("handoff"), z.null()]), angle: z.string().max(300) })
const AddPiece = z.object({
  clientSlug: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(300),
  url: z.union([z.literal(""), z.string().url().startsWith("https://").max(2000)]),
  type: z.string().trim().min(1).max(60),
  theme: z.string().trim().max(80),
  stage: z.enum(STAGES),
  audiences: z.array(z.string()).min(1).max(10),
  verticals: z.array(z.string()).max(20),
  purpose: z.string().trim().max(400),
  sequence: z.array(Email).max(3),
  /** Existing sequences to send the new piece in (ticked on the review step). */
  changes: z.array(z.object({ engagedId: Id, slot: Slot, angle: z.string().max(300) })).max(3),
  /** Claude's placement as the server signed it; only what's in here is saved as "Claude's pick". */
  suggestion: z.object({ payload: z.string().max(20_000), sig: z.string().max(200) }).nullable(),
})

/**
 * Adds a piece to the library with its sequence, and slots it into the existing sequences that were
 * ticked. The piece goes in through RLS; the emails are written by the server after that check,
 * because Claude's pick beside each one is server-only (and taken from the signed suggestion).
 */
export async function addPiece(raw: z.input<typeof AddPiece>): Promise<Result & { code?: string }> {
  const parsed = AddPiece.safeParse(raw)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.path.includes("url") ? "The page link must start with https://" : "Add a title and who it's written for." }
  const d = parsed.data
  const me = await getProfile()
  if (!canEdit(me)) return { ok: false, message: VIEW_ONLY }
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug").eq("slug", d.clientSlug).maybeSingle()
  if (!client) return { ok: false, message: "This client isn't available to you." }
  const cfg = libraryConfig(client.slug)
  if (!cfg) return { ok: false, message: "This client has no content library." }
  if (d.audiences.some((a) => !cfg.audiences.includes(a)) || d.verticals.some((v) => !cfg.verticals.includes(v))) return { ok: false, message: "Pick audiences and verticals from the list." }

  // Every id must be one of this client's pieces that's still in the library.
  const all = await codesFor(client.id)
  const live = new Map(all.filter((r) => !r.archived_at).map((r) => [r.id as string, r.code as string]))
  const idByCode = new Map([...live].map(([id, code]) => [code, id]))
  const ids = [...d.sequence.map((e) => e.target), ...d.changes.map((c) => c.engagedId)].filter((t): t is string => Boolean(t) && t !== "handoff")
  if (ids.some((id) => !live.has(id))) return { ok: false, message: "Some of the content picked isn't in this library any more. Refresh and try again." }
  if (d.sequence.some((e) => e.target === "handoff" && e.slot !== 3)) return { ok: false, message: "The sales handoff can only be email 3." }

  const row = { client_id: client.id, title: d.title, url: d.url || null, type: d.type, theme: d.theme || null, stage: d.stage, audiences: d.audiences, verticals: d.verticals, purpose: d.purpose || null }
  let piece: { id: string; code: string } | null = null
  for (let attempt = 0; attempt < 3 && !piece; attempt++) {
    const code = nextCode(attempt ? (await codesFor(client.id)).map((r) => r.code) : all.map((r) => r.code))
    const { data, error } = await supabase.from("content_pieces").insert({ ...row, code }).select("id, code").single()
    if (data) piece = data
    else if (error?.code !== "23505") return { ok: false, message: "Couldn't add the piece." }
  }
  if (!piece) return { ok: false, message: "Someone else added content at the same moment. Try again." }

  const claude = verifySuggestion(client.id, d.suggestion)
  const claudeId = (t: string | null) => (t && t !== "handoff" ? (idByCode.get(t) ?? null) : null)
  const db = createAdminClient()
  const now = new Date().toISOString()
  const emails = d.sequence
    .filter((e) => e.target || e.angle.trim())
    .map((e) => {
      const pick = claude?.sequence.find((s) => s.slot === e.slot && s.target)
      return {
        piece_id: piece.id,
        slot: e.slot,
        client_id: client.id,
        target_piece_id: e.target === "handoff" ? null : e.target,
        handoff: e.target === "handoff",
        angle: e.angle.trim() || null,
        updated_by_profile_id: me.id,
        ...(pick ? { suggested_target_piece_id: claudeId(pick.target), suggested_handoff: pick.target === "handoff", suggested_angle: pick.angle || null, suggested_at: now } : {}),
      }
    })
  if (emails.length) {
    const { error } = await db.from("content_sequences").insert(emails)
    if (error) return { ok: false, message: `Added ${piece.code}, but its sequence didn't save. Set it in the sequence builder.` }
  }
  for (const c of d.changes) {
    const signed = claude?.changes.find((s) => idByCode.get(s.engaged) === c.engagedId && s.slot === c.slot)
    const { error } = await db.from("content_sequences").upsert(
      {
        piece_id: c.engagedId,
        slot: c.slot,
        client_id: client.id,
        target_piece_id: piece.id,
        handoff: false,
        angle: c.angle.trim() || null,
        updated_by_profile_id: me.id,
        ...(signed ? { suggested_target_piece_id: piece.id, suggested_handoff: false, suggested_angle: signed.angle || null, suggested_at: now } : {}),
      },
      { onConflict: "piece_id,slot" },
    )
    if (error) return { ok: false, message: `Added ${piece.code}, but not every existing sequence was updated. Check the sequence builder.` }
  }
  const slotted = d.changes.length
  return { ...done(client.slug, slotted ? `Added, and slotted into ${slotted} existing sequence${slotted === 1 ? "" : "s"}` : "Added. Its sequence is awaiting approval"), code: piece.code }
}

const Approve = z.object({
  clientSlug: z.string().min(1).max(100),
  pieceId: Id,
  // Notion IDs are UUID-shaped but not always RFC-valid, so check the shape only.
  ownerNotionId: z.string().regex(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
})

/**
 * "Approve sequence": sends the email sequence brief to Master Production through the one Notion
 * write function (dry run unless Dean has switched writes on), then marks the sequence approved. A
 * changed sequence goes out as an update. One live page per approval (brief_key).
 */
export async function approveSequence(raw: z.input<typeof Approve>): Promise<Result> {
  const parsed = Approve.safeParse(raw)
  if (!parsed.success) return { ok: false, message: "Pick a Project Lead." }
  const { clientSlug, pieceId, ownerNotionId, dueDate } = parsed.data
  const me = await getProfile()
  if (!canEdit(me)) return { ok: false, message: VIEW_ONLY }
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, notion_client_option").eq("slug", clientSlug).maybeSingle()
  if (!client) return { ok: false, message: "This client isn't available to you." }
  const cfg = libraryConfig(client.slug)
  if (!cfg) return { ok: false, message: "This client has no content library." }
  const limited = await rateLimit(supabase, "notion_write")
  if (limited) return { ok: false, message: limited }

  const pieces = await loadLibrary(supabase, client.id)
  const piece = pieces.find((p) => p.id === pieceId)
  if (!piece) return { ok: false, message: "That piece isn't in this client's library." }
  if (piece.seqStatus === "approved") return { ok: false, message: "This sequence is already approved." }
  if (!piece.emails.some((e) => e.targetId || e.handoff)) return { ok: false, message: "Set at least one email before approving." }
  const person = (await peopleForClient(supabase, client.id)).find((p) => p.notionUserId === ownerNotionId)
  if (!person) return { ok: false, message: "Pick a Project Lead." }

  const { data: row } = await supabase.from("content_pieces").select("approval_round").eq("id", piece.id).single()
  const round = (row?.approval_round ?? 0) + 1
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")
  const libraryPath = `/clients/${client.slug}/library?view=sequences`
  const res = await createNotionAction(writeDeps(), {
    client,
    title: sequenceBriefTitle(piece),
    owner: { id: person.profileId ?? person.email, full_name: person.name, notion_user_id: person.notionUserId },
    dueDate,
    description: sequenceBriefText(piece, byId, { allVerticals: cfg.verticals, libraryUrl: `${appUrl}${libraryPath}` }),
    appLink: libraryPath,
    createdBy: { id: me.id, full_name: me.full_name, email: me.email },
    sequenceBrief: { contentPieceId: piece.id, briefKey: `sequence:${piece.id}:${round}`, vertical: notionVertical(cfg, piece.verticals) },
  })
  if (res.status === "failed") return { ok: false, message: res.error }

  // Approval is the server's (guard trigger); access was checked above through RLS. The round only
  // moves on from the one we read, so a double click can't approve twice.
  const { error } = await createAdminClient()
    .from("content_pieces")
    .update({ seq_status: "approved", reapproval: false, approved_at: new Date().toISOString(), approved_by_profile_id: me.id, approval_round: round, updated_by_profile_id: me.id })
    .eq("id", piece.id)
    .eq("approval_round", round - 1)
  if (error) return { ok: false, message: "The brief was logged, but the sequence couldn't be marked approved. Try again." }
  return done(client.slug, res.status === "created" ? "Approved. Brief sent to Master Production" : "Approved. Test mode: the brief was logged, nothing was sent to Notion")
}
