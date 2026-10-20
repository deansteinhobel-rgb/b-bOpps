/**
 * Keyword ads (Dean, 2026-10-20): per keyword and library, the top 30 live ads of the latest weekly
 * read in the library's own order, and the 3 creatives among them that have run longest. A plain
 * module (pages, Claude context, tests).
 *
 * "Running since" is the creative's, not the library entry's (Dean, 2026-10-20): Meta publishes an
 * edited ad as a new library entry with a new start date (DNSFilter's MSP ads, delivering since
 * 18 Sept in our own data, showed as started 19 Oct). So Meta reads ask for stopped ads too, and
 * every version with the same advertiser, headline and copy counts as one creative, running since
 * its earliest version, or since we first saw it if that's earlier.
 */
import type { KeywordSource } from "./sources"

export type KeywordAd = {
  id: string
  keyword_id: string
  source: KeywordSource
  external_id: string
  advertiser: string | null
  headline: string | null
  body: string | null
  ranks: Record<string, number>
  started_on: string | null
  ended_on: string | null
  first_seen_at: string
  last_seen_at: string
}

/** Ads seen within this long of a keyword's latest read belong to that read (a read spans a few hours). */
const READ_WINDOW_MS = 2 * 86_400_000

/** The ad's best place across countries in its latest read. */
export const bestRank = (a: Pick<KeywordAd, "ranks">) => Math.min(...Object.values(a.ranks).filter((n) => Number.isFinite(n)), Infinity)

/** The latest read's live ads for one keyword and library, in the library's order, at most `n`. */
export function topAds<T extends KeywordAd>(ads: T[], n = 30): T[] {
  const live = ads.filter((a) => !a.ended_on)
  if (!live.length) return []
  const latest = Math.max(...live.map((a) => Date.parse(a.last_seen_at)))
  return live
    .filter((a) => latest - Date.parse(a.last_seen_at) <= READ_WINDOW_MS && Number.isFinite(bestRank(a)))
    .sort((a, b) => bestRank(a) - bestRank(b) || a.external_id.localeCompare(b.external_id))
    .slice(0, n)
}

/** Advertiser names compared loosely ("DNSFilter", "DNS Filter Inc."). */
const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/\b(inc|llc|ltd|limited|corp|corporation)\b/g, "").replace(/[^a-z0-9]/g, "")
const text = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 300)

type Versioned = { source: string; advertiser?: string | null; competitor_id?: string; headline: string | null; body: string | null }
/** One creative across library versions: the same advertiser, headline and copy. */
export const creativeKey = (a: Versioned) => `${a.source}|${a.competitor_id ?? norm(a.advertiser ?? null)}|${text(a.headline)}|${text(a.body)}`

type Dated = Versioned & { id: string; external_id: string; started_on: string | null; first_seen_at: string }
/**
 * When each ad's creative started: the earliest start date (or first time we saw it) across every
 * version we hold, and for LinkedIn, whose ids rise over time, the lowest id among the versions.
 */
export function runningSince<T extends Dated>(versions: T[]) {
  const groups = new Map<string, { since: string; minId: number }>()
  for (const a of versions) {
    const k = creativeKey(a)
    const day = [a.started_on, a.first_seen_at.slice(0, 10)].filter(Boolean).sort()[0]!
    const id = Number(a.external_id)
    const g = groups.get(k)
    if (!g) groups.set(k, { since: day, minId: Number.isFinite(id) ? id : Infinity })
    else {
      if (day < g.since) g.since = day
      if (Number.isFinite(id) && id < g.minId) g.minId = id
    }
  }
  return (a: Dated) => groups.get(creativeKey(a)) ?? { since: [a.started_on, a.first_seen_at.slice(0, 10)].filter(Boolean).sort()[0]!, minId: Number(a.external_id) }
}

/**
 * The `n` creatives among the top ads that have run longest, leaving out the client's own and
 * second versions of the same creative. Meta by when the creative started (its earliest version).
 * LinkedIn rarely shows run dates, but its ad ids rise over time, so the lowest id is the oldest
 * (an estimate, which the page says). `versions` = every version we hold, stopped ones included.
 */
export function longestRunning<T extends KeywordAd>(top: T[], own: string[], n = 3, versions: KeywordAd[] = top): T[] {
  const mine = new Set(own.map(norm).filter(Boolean))
  const since = runningSince(versions)
  const key = (a: T) => (a.source === "linkedin" ? since(a).minId : Date.parse(since(a).since))
  const seen = new Set<string>()
  return top
    .filter((a) => !mine.has(norm(a.advertiser)))
    .sort((a, b) => key(a) - key(b))
    .filter((a) => {
      const k = creativeKey(a)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, n)
}
