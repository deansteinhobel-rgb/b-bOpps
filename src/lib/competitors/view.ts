/**
 * Competitor ads page rules. A plain module (server and client components, and tests).
 */
import type { CompetitorSource } from "./sources"

/** The platform mark each library is shown with (`PlatformIcon`). */
export const SOURCE_PLATFORM = { meta: "meta", google: "google_ads", linkedin: "linkedin" } as const satisfies Record<CompetitorSource, string>

/** "New" = first seen by us in the last 8 days (one weekly read, with a day's slack). */
export const NEW_DAYS = 8

export type AdRow = {
  id: string
  competitor_id: string
  source: CompetitorSource
  external_id: string
  /** When the creative started: its earliest version in the library (Meta re-dates edited ads). */
  started_on: string | null
  /** This library entry's own start date, when it's later than the creative's. */
  version_started_on: string | null
  first_seen_at: string
  last_seen_at: string
  active: boolean
  countries: string[]
  format: string | null
  headline: string | null
  body: string | null
  cta: string | null
  landing_url: string | null
  library_url: string | null
  src: string | null
  label_format: string | null
  label_content_type: string | null
  label_offer: string | null
  label_hook: string | null
  label_topic: string | null
  label_summary: string | null
}

const DAY = 86_400_000

/** Days the ad has run: from the library's start date, or from when we first saw it (LinkedIn shows none). */
export function daysLive(ad: Pick<AdRow, "started_on" | "first_seen_at">, today: string) {
  const from = ad.started_on ?? ad.first_seen_at.slice(0, 10)
  return Math.max(0, Math.round((Date.parse(today) - Date.parse(from)) / DAY))
}
/**
 * Whether the days count is a minimum, so the page says "at least": ours (first seen) rather than the
 * library's, or Meta's, which starts again when an ad is edited and keeps no earlier entry (DNSFilter's
 * MSP ads, delivering since 18 Sept, showed as started 19 Oct).
 */
export const daysAreEstimate = (ad: Pick<AdRow, "started_on" | "source">) => !ad.started_on || ad.source === "meta"

/**
 * When we first read each competitor on each library ("competitor|source" → day). Ads found in that
 * first read were already running, so they aren't new.
 */
export function firstReads(ads: Pick<AdRow, "competitor_id" | "source" | "first_seen_at">[]) {
  const out = new Map<string, string>()
  for (const a of ads) {
    const k = `${a.competitor_id}|${a.source}`
    const day = a.first_seen_at.slice(0, 10)
    if (!out.has(k) || day < out.get(k)!) out.set(k, day)
  }
  return out
}

/**
 * New = started in the last 8 days (one weekly read, with a day's slack), by the library's start date
 * where it gives one; otherwise first seen in that window, but not in our first read of that competitor.
 */
export function isNew(ad: Pick<AdRow, "competitor_id" | "source" | "started_on" | "first_seen_at">, today: string, first: Map<string, string>) {
  const recent = (day: string) => Date.parse(today) - Date.parse(day) <= NEW_DAYS * DAY
  if (ad.started_on) return recent(ad.started_on)
  const seen = ad.first_seen_at.slice(0, 10)
  return recent(seen) && seen !== first.get(`${ad.competitor_id}|${ad.source}`)
}

/**
 * Share of ads per label value, biggest first, with "Other" and blanks left out of the ranking but
 * kept in the total. Used for "Them vs us".
 */
export function labelMix(values: (string | null)[]): { value: string; share: number; count: number }[] {
  const labeled = values.filter((v): v is string => !!v)
  if (!labeled.length) return []
  const counts = new Map<string, number>()
  for (const v of labeled) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([v]) => v !== "Other")
    .map(([value, count]) => ({ value, count, share: count / labeled.length }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

/** Them vs us for one label: every value either side uses, with both shares, biggest gap first. */
export function compareMix(them: (string | null)[], us: (string | null)[], top = 6) {
  const a = new Map(labelMix(them).map((x) => [x.value, x.share]))
  const b = new Map(labelMix(us).map((x) => [x.value, x.share]))
  return [...new Set([...a.keys(), ...b.keys()])]
    .map((value) => ({ value, them: a.get(value) ?? 0, us: b.get(value) ?? 0 }))
    .sort((x, y) => Math.max(y.them, y.us) - Math.max(x.them, x.us))
    .slice(0, top)
}
