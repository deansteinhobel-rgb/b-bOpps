/**
 * What Claude may suggest for the content library, and the checks its answers go through before the
 * app uses them. Claude works with the library's codes (C01, C02 ...), never database ids. Plain
 * module, tested in suggestions.test.ts.
 */
import { STAGES, type LibraryConfig, type Stage } from "./config"

export const HANDOFF = "HANDOFF"
export type Target = string | "handoff" | null // a piece code, the sales handoff, or not set
export type SuggestedEmail = { slot: 1 | 2 | 3; target: Target; angle: string }
export type SuggestedChange = { engaged: string; slot: 1 | 2 | 3; angle: string; reason: string }
export type Placement = { theme: string; stage: Stage; purpose: string; verticals: string[]; sequence: SuggestedEmail[]; changes: SuggestedChange[] }

export type PromptPiece = { code: string; title: string; type: string; theme: string | null; stage: string; audiences: string[]; verticals: string[]; purpose: string | null }
/** Each piece's sequence by code: the three targets (piece code, HANDOFF or ""). */
export type PromptSequences = Record<string, [string, string, string]>

const clip = (v: unknown, n: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .slice(0, n)

const SLOTS = [1, 2, 3] as const

/**
 * Claude's three emails, checked: unknown codes, the piece itself and repeats within one sequence
 * become "not set", and the sales handoff is only allowed as email 3.
 */
export function cleanSequence(raw: unknown, codes: ReadonlySet<string>, self: string | null): SuggestedEmail[] {
  const r = (raw ?? {}) as Record<string, { id?: unknown; angle?: unknown } | undefined>
  const used = new Set<string>()
  return SLOTS.map((slot) => {
    const v = r[`email${slot}`]
    const id = String(v?.id ?? "").trim()
    let target: Target = null
    if (id === HANDOFF && slot === 3) target = "handoff"
    else if (codes.has(id) && id !== self && !used.has(id)) target = id
    if (target && target !== "handoff") used.add(target)
    return { slot, target, angle: target ? clip(v?.angle, 200) : "" }
  })
}

/** Claude's placement of a new piece, checked against the client's lists and the library. */
export function cleanPlacement(raw: unknown, cfg: Pick<LibraryConfig, "verticals">, codes: ReadonlySet<string>): Placement {
  const r = (raw ?? {}) as Record<string, unknown>
  const stage = STAGES.find((s) => s === r.stage) ?? "Awareness"
  const verticals = (Array.isArray(r.verticals) ? r.verticals : []).filter((v): v is string => typeof v === "string" && cfg.verticals.includes(v))
  const seen = new Set<string>()
  const changes = (Array.isArray(r.changes) ? r.changes : [])
    .map((c) => (c ?? {}) as Record<string, unknown>)
    .map((c) => ({ engaged: String(c.engagedId ?? c.engaged ?? "").trim(), slot: Number(String(c.slot ?? "").replace(/\D/g, "")) as 1 | 2 | 3, angle: clip(c.angle, 200), reason: clip(c.reason, 160) }))
    .filter((c) => codes.has(c.engaged) && SLOTS.includes(c.slot) && !seen.has(`${c.engaged}:${c.slot}`) && seen.add(`${c.engaged}:${c.slot}`))
    .slice(0, 3)
  return {
    theme: clip(r.theme, 80),
    stage,
    purpose: clip(r.purpose, 400),
    verticals: [...new Set(verticals)],
    sequence: cleanSequence(r.sequence, codes, null),
    changes,
  }
}

/** The rules every content library prompt shares (from the Camber artifact). */
export function sequenceRules(cfg: Pick<LibraryConfig, "companyLine" | "audiences">) {
  return `${cfg.companyLine} Every piece of content has a 3-email follow-up sequence sent to anyone who engaged with it.
Sequence logic:
- email1 goes deeper on the same theme.
- email2 opens an adjacent theme.
- email3 moves them down the funnel, usually to a Decision-stage piece. If the engaged piece is itself Decision stage, email3 is "${HANDOFF}" (the sales handoff).
- Respect writtenFor (${cfg.audiences.join(", ")}): only send a piece to someone whose engaged piece shares at least one writtenFor value with it.
- Prefer follow-ups that share a vertical with the engaged piece.
- Never put a piece in its own sequence, and never repeat a piece within one sequence.
- An "angle" is one line, under 20 words, that a copywriter turns into the email: the hook connecting what they read to what this email sends. Plain and specific, no hype, no exclamation marks.`
}

export const promptLibrary = (pieces: readonly PromptPiece[]) =>
  JSON.stringify(pieces.map((p) => ({ id: p.code, title: p.title, type: p.type, theme: p.theme ?? "", stage: p.stage, writtenFor: p.audiences, verticals: p.verticals, purpose: p.purpose ?? "" })))
