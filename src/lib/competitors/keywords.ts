/**
 * Keyword ads (Dean, 2026-10-20): per keyword and library, the top 30 ads of the latest weekly read
 * in the library's own order, and the 3 of those that have run longest. A plain module (page,
 * Claude context, tests).
 */
import type { KeywordSource } from "./sources"

export type KeywordAd = {
  id: string
  keyword_id: string
  source: KeywordSource
  external_id: string
  advertiser: string | null
  ranks: Record<string, number>
  started_on: string | null
  first_seen_at: string
  last_seen_at: string
}

/** Ads seen within this long of a keyword's latest read belong to that read (a read spans a few hours). */
const READ_WINDOW_MS = 2 * 86_400_000

/** The ad's best place across countries in its latest read. */
export const bestRank = (a: Pick<KeywordAd, "ranks">) => Math.min(...Object.values(a.ranks).filter((n) => Number.isFinite(n)), Infinity)

/** The latest read's ads for one keyword and library, in the library's order, at most `n`. */
export function topAds<T extends KeywordAd>(ads: T[], n = 30): T[] {
  if (!ads.length) return []
  const latest = Math.max(...ads.map((a) => Date.parse(a.last_seen_at)))
  return ads
    .filter((a) => latest - Date.parse(a.last_seen_at) <= READ_WINDOW_MS)
    .sort((a, b) => bestRank(a) - bestRank(b) || a.external_id.localeCompare(b.external_id))
    .slice(0, n)
}

/** Advertiser names compared loosely ("DNSFilter", "DNS Filter Inc."). */
const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/\b(inc|llc|ltd|limited|corp|corporation)\b/g, "").replace(/[^a-z0-9]/g, "")

/**
 * The `n` of the top ads that have run longest, leaving out the client's own. Meta gives a start
 * date. LinkedIn rarely does, but its ad ids rise over time, so the lowest id still running is
 * the oldest: LinkedIn is ordered by id (an estimate, which the page says).
 */
export function longestRunning<T extends KeywordAd>(top: T[], own: string[], n = 3): T[] {
  const mine = new Set(own.map(norm).filter(Boolean))
  const others = top.filter((a) => !mine.has(norm(a.advertiser)))
  const key = (a: T) => (a.source === "linkedin" ? Number(a.external_id) : Date.parse(a.started_on ?? a.first_seen_at.slice(0, 10)))
  return [...others].sort((a, b) => key(a) - key(b)).slice(0, n)
}
