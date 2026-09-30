/**
 * The ICP check on a Google campaign's search terms (Dean, 2026-09-30): what Claude returns and the
 * rules the app puts on it. A plain module: the page and the server both use it.
 */
import { cleanTerm, type MatchType } from "@/lib/windsor/negatives"

export type TermVerdict = { term: string; verdict: "exclude" | "watch"; reason: string }
/** A shorter negative that blocks a whole theme (e.g. phrase "jobs"). `blocked` = terms we saw that it would block. */
export type RootNegative = { text: string; matchType: MatchType; reason: string; blocked: number; blockedSpend: number; unsafe: string | null }
export type KeywordVerdict = { keyword: string; verdict: "pause" | "review"; reason: string }

export type TermReview = {
  id: string
  createdAt: string
  from: string
  to: string
  termsSent: number
  headline: string
  points: string[]
  terms: TermVerdict[]
  roots: RootNegative[]
  keywords: KeywordVerdict[]
}

export type SeenTerm = { text: string; spend: number; results: number }

/** Would this negative block the search? Negatives never match close variants (see MATCHING_PRIMER). */
export function negativeBlocks(negative: string, matchType: MatchType, search: string) {
  const n = cleanTerm(negative).split(" ")
  const s = cleanTerm(search).split(" ")
  if (matchType === "EXACT") return n.join(" ") === s.join(" ")
  if (matchType === "BROAD") return n.every((w) => s.includes(w))
  for (let i = 0; i + n.length <= s.length; i++) if (n.every((w, j) => s[i + j] === w)) return true
  return false
}

/** Counts what a suggested negative would block, and marks it unsafe when it blocks a search that converted. */
export function checkRoot(root: Pick<RootNegative, "text" | "matchType">, seen: SeenTerm[]): Pick<RootNegative, "blocked" | "blockedSpend" | "unsafe"> {
  const hit = seen.filter((t) => negativeBlocks(root.text, root.matchType, t.text))
  const converting = hit.filter((t) => t.results > 0).sort((a, b) => b.results - a.results)
  return {
    blocked: hit.length,
    blockedSpend: hit.reduce((a, t) => a + t.spend, 0),
    unsafe: converting.length ? `Would also block "${converting[0].text}"${converting.length > 1 ? ` and ${converting.length - 1} more` : ""}, which converted` : null,
  }
}
