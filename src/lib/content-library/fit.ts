/**
 * How well two pieces of content promote each other (the content library's Matrix), ported from the
 * Camber content library artifact. Rows are the piece someone engaged with, columns what to promote
 * next. Plain rules, no Claude: theme, verticals, audience and funnel stage, plus the sequences the
 * team has already set up. Plain module, used by the page and tested in fit.test.ts.
 */
import { STAGES, type Stage } from "./config"

export type FitPiece = { id: string; title: string; theme: string | null; stage: string; audiences: string[]; verticals: string[] }
/** Each piece's sequence: the piece ids its emails send, by slot (null = not set or the sales handoff). */
export type Sequences = ReadonlyMap<string, readonly { slot: number; targetId: string | null }[]>
export type FitLevel = 0 | 1 | 2 | 3
export type Fit = { score: number; level: FitLevel; reasons: string[] }

export const FIT_LABEL: Record<FitLevel, string> = { 0: "No real fit", 1: "Possible", 2: "Good fit", 3: "Strong fit" }

const stageIndex = (s: string) => STAGES.indexOf(s as Stage)
const levelOf = (score: number): FitLevel => (score >= 6 ? 3 : score >= 4 ? 2 : score >= 2 ? 1 : 0)

/** Fit of promoting `b` to someone who engaged with `a`. `allVerticals` is the client's full list. */
export function pairFit(a: FitPiece, b: FitPiece, sequences: Sequences, allVerticals: readonly string[]): Fit {
  // Different audiences never fit: an SMB reader shouldn't get a PE piece.
  if (a.audiences.length && b.audiences.length && !a.audiences.some((x) => b.audiences.includes(x))) {
    return { score: 0, level: 0, reasons: ["Written for different audiences"] }
  }
  const reasons: string[] = []
  let score = 0
  if (a.theme && a.theme === b.theme) {
    score += 3
    reasons.push(`Same theme: ${a.theme}`)
  }
  const all = (v: string[]) => allVerticals.length > 0 && allVerticals.every((x) => v.includes(x))
  if (a.verticals.length && b.verticals.length) {
    const allA = all(a.verticals)
    const allB = all(b.verticals)
    if (!allA && !allB) {
      const shared = a.verticals.filter((v) => b.verticals.includes(v))
      if (shared.length) {
        score += 2
        reasons.push(`Both cover ${shared.join(", ")}`)
      } else {
        score -= 2
        reasons.push("No vertical in common")
      }
    } else {
      score += 1
      reasons.push(allA && allB ? "Both relevant to every vertical" : "Relevant across verticals")
    }
  }
  const step = stageIndex(b.stage) - stageIndex(a.stage)
  if (stageIndex(a.stage) >= 0 && stageIndex(b.stage) >= 0 && step > 0) {
    score += 1
    reasons.push(`Moves them from ${a.stage} to ${b.stage}`)
  }
  const sent = sequences.get(a.id)?.find((e) => e.targetId === b.id)
  if (sent) {
    score += 2
    reasons.push(`Already email ${sent.slot} in its sequence`)
  }
  if (sequences.get(b.id)?.some((e) => e.targetId === a.id)) {
    score += 1
    reasons.push("Its own sequence sends readers back here")
  }
  return { score, level: levelOf(score), reasons }
}

/** The pieces that promote best alongside `selected`, strongest first (no "no real fit"). */
export function bestPairings(selected: FitPiece, pieces: readonly FitPiece[], sequences: Sequences, allVerticals: readonly string[], limit = 6) {
  return pieces
    .filter((p) => p.id !== selected.id)
    .map((piece) => ({ piece, ...pairFit(selected, piece, sequences, allVerticals) }))
    .filter((x) => x.level > 0)
    .sort((x, y) => y.score - x.score || x.piece.title.localeCompare(y.piece.title))
    .slice(0, limit)
}

/** How many other pieces' sequences send this one as a follow-up. Zero = it isn't cross-promoted. */
export function timesSent(pieceId: string, sequences: Sequences) {
  let n = 0
  for (const [from, emails] of sequences) if (from !== pieceId) n += emails.filter((e) => e.targetId === pieceId).length
  return n
}
