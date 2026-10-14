import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

export type SeqStatus = "pending" | "approved" | "not_required"

/** One email of a piece's follow-up sequence. `targetId` null with `handoff` false = not set. */
export type LibraryEmail = {
  slot: 1 | 2 | 3
  targetId: string | null
  handoff: boolean
  angle: string | null
  /** The email still matches Claude's pick (piece and angle). */
  claudesPick: boolean
  /** What Claude picked for this email, when it picked anything (for "Claude picked …" and Revert). */
  suggested: { targetId: string | null; handoff: boolean; angle: string | null } | null
}

export type LibraryPiece = {
  id: string
  code: string
  title: string
  url: string | null
  type: string
  theme: string | null
  stage: string
  audiences: string[]
  verticals: string[]
  purpose: string | null
  seqStatus: SeqStatus
  reapproval: boolean
  approvedAt: string | null
  notionPageUrl: string | null
  createdAt: string
  emails: LibraryEmail[]
}

/**
 * The client's content library: every piece that isn't archived, with its sequence. Pass a client
 * the caller has already loaded through RLS, and the user's own Supabase client: the tables' RLS
 * scopes the reads too. An email may point at an archived piece; the page shows it as removed.
 */
export async function loadLibrary(supabase: SupabaseClient, clientId: string): Promise<LibraryPiece[]> {
  const [pieces, emails] = await Promise.all([
    supabase
      .from("content_pieces")
      .select("id, code, title, url, type, theme, stage, audiences, verticals, purpose, seq_status, reapproval, approved_at, notion_page_url, created_at")
      .eq("client_id", clientId)
      .order("code"),
    supabase
      .from("content_sequences")
      .select("piece_id, slot, target_piece_id, handoff, angle, suggested_target_piece_id, suggested_handoff, suggested_angle")
      .eq("client_id", clientId),
  ])
  if (pieces.error) throw new Error(pieces.error.message)
  if (emails.error) throw new Error(emails.error.message)

  const byPiece = new Map<string, LibraryEmail[]>()
  for (const e of emails.data ?? []) {
    const picked = e.suggested_handoff !== null || e.suggested_target_piece_id !== null
    const list = byPiece.get(e.piece_id) ?? []
    list.push({
      slot: e.slot,
      targetId: e.target_piece_id,
      handoff: e.handoff,
      angle: e.angle,
      claudesPick: picked && e.target_piece_id === e.suggested_target_piece_id && e.handoff === Boolean(e.suggested_handoff) && (e.angle ?? "") === (e.suggested_angle ?? ""),
      suggested: picked ? { targetId: e.suggested_target_piece_id, handoff: Boolean(e.suggested_handoff), angle: e.suggested_angle } : null,
    })
    byPiece.set(e.piece_id, list)
  }

  return (pieces.data ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    title: p.title,
    url: p.url,
    type: p.type,
    theme: p.theme,
    stage: p.stage,
    audiences: p.audiences ?? [],
    verticals: p.verticals ?? [],
    purpose: p.purpose,
    seqStatus: p.seq_status,
    reapproval: p.reapproval,
    approvedAt: p.approved_at,
    notionPageUrl: p.notion_page_url,
    createdAt: p.created_at,
    emails: [1, 2, 3].map((slot) => byPiece.get(p.id)?.find((e) => e.slot === slot) ?? { slot: slot as 1 | 2 | 3, targetId: null, handoff: false, angle: null, claudesPick: false, suggested: null }),
  }))
}
