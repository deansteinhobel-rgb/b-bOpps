/**
 * The weekly read (Dean, 2026-10-21, after ZenABM's reports: "easy to digest"): the week in one
 * sentence, then what's working / what needs attention / where to act, then the numbers and the
 * evidence. This module holds the shapes both views share and the wording rules, so they can be
 * tested; `weekly-read.ts` loads the data. A plain module: used by server and client components.
 */
import type { Preview } from "@/lib/previews"
import type { Platform } from "@/lib/metrics/types"

export type Tone = "good" | "bad" | "neutral"
export type IconKey = "doc" | "image" | "search" | "wallet" | "repeat" | "users" | "building" | "target" | "bolt" | "trend-up" | "trend-down" | "title" | "refresh" | "split" | "goal" | "flag"

/** An ad named in the read: shown with its preview wherever it's mentioned. */
export type ReadAd = { key: string; name: string; platform: Platform; preview: Preview | null }
/** One line in the three columns: a title, one line of evidence, maybe the ads it's about and one action. */
export type ReadItem = { key: string; icon: IconKey; title: string; tag?: string; detail: string; platform?: Platform | null; ads?: ReadAd[]; href?: string; action?: { label: string; href: string } }
export type Tile = { label: string; hint?: string; now: string; before: string | null; change: string | null; tone: Tone; spark: number[] }
export type Flag = { key: string; kind: string; subject: string; detail: string; platform?: Platform | null; ad?: ReadAd; href?: string }
export type Verdict = { headline: string; tone: Tone; body: string; trend: number[]; trendLabel: string }

export type ReadCore = { verdict: Verdict; working: ReadItem[]; attention: ReadItem[]; act: ReadItem[]; tiles: Tile[]; green: Flag[]; red: Flag[] }

export type PlatformRow = { platform: Platform; spend: number; results: number; cpr: number | null; prevCpr: number | null; target: number | null; month: { spend: number; budget: number | null; expected: number } | null }
export type AdRow = { ad: ReadAd; format: string; campaign: string | null; results: number; cpr: number | null; ctr: number | null; spend: number }
export type OverallRead = ReadCore & { platforms: PlatformRow[]; ads: AdRow[] }

export type FormatRow = { format: string; ads: ReadAd[]; count: number; spend: number; impressions: number; clicks: number; results: number }
export type AccountRow = { name: string; impressions: number; clicks: number; spend: number; campaigns: number; ctr: number | null; fit: "icp" | "not_icp" | "unsure" | null; fitReason: string | null; reason?: string; trend: number[] }
export type TitleRow = { title: string; spend: number; impressions: number; clicks: number; ctr: number | null }
export type AbxRead = ReadCore & {
  segmentLabel: string
  formats: FormatRow[]
  ads: AdRow[]
  prioritize: AccountRow[]
  watch: AccountRow[]
  titles: TitleRow[]
  /** The LinkedIn snapshot the account lists come from (30-day totals, refreshed about weekly). */
  accountsThrough: string | null
}

export type WeeklyRead = {
  client: { name: string; slug: string; currency: string; logoUrl: string | null }
  week: { from: string; to: string; prevFrom: string; prevTo: string }
  dataThrough: string
  complete: boolean
  overall: OverallRead
  abx: AbxRead | null
}

// ---------- Rules ----------

/** Percent change, or null when there's nothing to compare. */
export const change = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : (now - before) / before)

/** "+24%", "−17%" (a real minus sign). */
export const pctText = (c: number | null) => (c === null ? null : `${c >= 0 ? "+" : "−"}${Math.round(Math.abs(c) * 100)}%`)

/**
 * How the week went, judged on cost per result against target when there is one and results came in,
 * otherwise on results against the week before. Good: at or under target (or results up 10%+ with no
 * target). Bad: no results after spending the target, 20%+ over target, or results down 20%+ with no
 * target. Anything else is neutral.
 */
export function weekTone(p: { results: number; prevResults: number; spend: number; cpr: number | null; target: number | null }): Tone {
  if (p.results === 0) return p.spend > 0 && (p.target === null || p.spend >= p.target) ? "bad" : "neutral"
  if (p.target !== null && p.cpr !== null) return p.cpr <= p.target ? "good" : p.cpr > p.target * 1.2 ? "bad" : "neutral"
  const c = change(p.results, p.prevResults)
  return c === null ? "neutral" : c >= 0.1 ? "good" : c <= -0.2 ? "bad" : "neutral"
}

/** The headline: how the week went in a few words, then the results line. */
export function verdictHeadline(p: { tone: Tone; results: number; spend: string; cpr: string | null; target: string | null; underTarget: boolean | null }) {
  const lead = p.tone === "good" ? "A good week" : p.tone === "bad" ? "A hard week" : "A steady week"
  // Google reports fractional conversions; the headline counts whole results.
  const n = Math.round(p.results)
  if (n === 0) return `${lead}: ${p.spend} spent with no results`
  const each = p.cpr ? ` at ${p.cpr} each` : ""
  const vs = p.target && p.underTarget !== null ? `, ${p.underTarget ? "under" : "over"} the ${p.target} target` : ""
  return `${lead}: ${n.toLocaleString("en-US")} result${n === 1 ? "" : "s"}${each}${vs}`
}

/** "rose to 41 from 33", "fell to $187 from $226", "held at 12". */
export const moved = (now: string, before: string, up: boolean | null) => (up === null ? `held at ${now}` : `${up ? "rose" : "fell"} to ${now} from ${before}`)

/** The 8 weekly totals ending with `to` from daily points (oldest first). */
export function weeklyBuckets(daily: { date: string; value: number }[], to: string, weeks = 8) {
  const end = Date.parse(`${to}T00:00:00Z`)
  const out = Array.from({ length: weeks }, () => 0)
  for (const d of daily) {
    const back = Math.floor((end - Date.parse(`${d.date}T00:00:00Z`)) / 86_400_000)
    if (back < 0) continue
    const w = weeks - 1 - Math.floor(back / 7)
    if (w >= 0) out[w] += d.value
  }
  return out
}

/**
 * Accounts (LinkedIn companies) clicking at least `times` the ABX average, with enough impressions
 * and clicks to mean something.
 */
export function surging<T extends { impressions: number; clicks: number }>(rows: T[], times = 3, minImpressions = 100, minClicks = 3) {
  const imp = rows.reduce((s, r) => s + r.impressions, 0)
  const avg = imp ? rows.reduce((s, r) => s + r.clicks, 0) / imp : 0
  return { avg, rows: avg ? rows.filter((r) => r.impressions >= minImpressions && r.clicks >= minClicks && r.clicks / r.impressions >= avg * times) : [] }
}
