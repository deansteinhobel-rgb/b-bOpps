import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { nextCode } from "./config"
import { loadLibrary, type LibraryPiece } from "./load"
import { HANDOFF, type PromptPiece, type PromptSequences, type SuggestedEmail } from "./suggestions"

/** The library as Claude sees it: pieces and sequences by code (never database ids). */
export function forPrompt(pieces: LibraryPiece[]) {
  const codeOf = new Map(pieces.map((p) => [p.id, p.code]))
  const library: PromptPiece[] = pieces.map((p) => ({ code: p.code, title: p.title, type: p.type, theme: p.theme, stage: p.stage, audiences: p.audiences, verticals: p.verticals, purpose: p.purpose }))
  const sequences: PromptSequences = Object.fromEntries(
    pieces.map((p) => [p.code, p.emails.map((e) => (e.handoff ? HANDOFF : e.targetId ? (codeOf.get(e.targetId) ?? "") : "")) as [string, string, string]]),
  )
  return { library, sequences }
}

/** Every code the client has used, archived pieces included (read with the admin client: RLS hides archived rows). */
export async function codesFor(clientId: string) {
  const { data, error } = await createAdminClient().from("content_pieces").select("id, code, archived_at").eq("client_id", clientId)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function newCode(clientId: string) {
  return nextCode((await codesFor(clientId)).map((r) => r.code))
}

/**
 * Saves Claude's new picks for one piece ("Ask Claude again"). An email that still follows Claude
 * (not set, or still Claude's pick) takes the new pick; an email the team changed keeps their choice
 * and only Claude's pick beside it is updated. Server write (Claude's pick is server-only); the caller
 * has checked the person can edit this client.
 */
export async function saveRepick(clientId: string, piece: LibraryPiece, picks: SuggestedEmail[], idOf: (code: string) => string | null, by: string) {
  const db = createAdminClient()
  let changed = 0
  let kept = 0
  const now = new Date().toISOString()
  for (const pick of picks) {
    if (!pick.target) continue
    const targetId = pick.target === "handoff" ? null : idOf(pick.target)
    if (pick.target !== "handoff" && !targetId) continue
    const handoff = pick.target === "handoff"
    const cur = piece.emails.find((e) => e.slot === pick.slot)!
    const followsClaude = (!cur.targetId && !cur.handoff) || !cur.suggested || cur.claudesPick
    const suggested = { suggested_target_piece_id: targetId, suggested_handoff: handoff, suggested_angle: pick.angle || null, suggested_at: now }
    const row = followsClaude ? { ...suggested, target_piece_id: targetId, handoff, angle: pick.angle || null } : suggested
    if (followsClaude && (cur.targetId !== targetId || cur.handoff !== handoff)) changed++
    if (!followsClaude) kept++
    const { error } = await db.from("content_sequences").upsert({ piece_id: piece.id, slot: pick.slot, client_id: clientId, updated_by_profile_id: by, ...row }, { onConflict: "piece_id,slot" })
    if (error) throw new Error(error.message)
  }
  return { changed, kept }
}

/** The library for one client, through the person's own client (RLS), plus a code → id lookup. */
export async function libraryFor(supabase: SupabaseClient, clientId: string) {
  const pieces = await loadLibrary(supabase, clientId)
  const byCode = new Map(pieces.map((p) => [p.code, p]))
  return { pieces, byCode, idOf: (code: string) => byCode.get(code)?.id ?? null }
}
