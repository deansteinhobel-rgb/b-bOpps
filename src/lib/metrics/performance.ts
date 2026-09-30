import type { SupabaseClient } from "@supabase/supabase-js"
import { money, percent, whole } from "@/lib/format"
import { rpcAll } from "@/lib/supabase/rpc-all"
import { addDaysIso, bucketsFor, encodeRange, resolveRange, type Periods, type RangeSpec } from "./range"
import type { Platform } from "./types"

/** The Performance tab's numbers: a period against the one before it, per platform and campaign. */
export type { Periods } from "./range"

export type Sums = { spend: number; impressions: number; clicks: number; conversions: number; leads: number }
export type MetricKey = "spend" | "impressions" | "clicks" | "ctr" | "cpc" | "results" | "cvr" | "cpr"
export type Derived = Sums & { results: number; ctr: number | null; cpc: number | null; cvr: number | null; cpr: number | null }

export const METRIC: Record<MetricKey, { label: string; unit: "money" | "count" | "percent"; better: "up" | "down" | "none" }> = {
  spend: { label: "Spend", unit: "money", better: "none" },
  impressions: { label: "Impressions", unit: "count", better: "up" },
  clicks: { label: "Clicks", unit: "count", better: "up" },
  ctr: { label: "CTR", unit: "percent", better: "up" },
  cpc: { label: "CPC", unit: "money", better: "down" },
  results: { label: "Results", unit: "count", better: "up" },
  cvr: { label: "Conversion rate", unit: "percent", better: "up" },
  cpr: { label: "Cost per result", unit: "money", better: "down" },
}

/** A metric value for display (usable on the server and in the browser). */
export function fmt(k: MetricKey, v: number | null, currency: string) {
  if (v === null || v === undefined) return "–"
  const u = METRIC[k].unit
  return u === "money" ? money(v, currency, v < 10 && k !== "spend" ? 2 : 0) : u === "percent" ? percent(v, 2) : whole(v)
}

export const zero = (): Sums => ({ spend: 0, impressions: 0, clicks: 0, conversions: 0, leads: 0 })
export function add(a: Sums, b: Sums): Sums {
  return { spend: a.spend + b.spend, impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, conversions: a.conversions + b.conversions, leads: a.leads + b.leads }
}
const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
export function derive(s: Sums): Derived {
  const results = s.conversions + s.leads
  return { ...s, results, ctr: ratio(s.clicks, s.impressions), cpc: ratio(s.spend, s.clicks), cvr: ratio(results, s.clicks), cpr: ratio(s.spend, results) }
}
export const value = (d: Derived, k: MetricKey) => d[k]

/** % change, or null when there's nothing to compare against. */
export const change = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : (now / before - 1) * 100)

/** Whether a change is good, bad or neutral for this metric. */
export function tone(k: MetricKey, pct: number | null): "good" | "bad" | "neutral" {
  if (pct === null || Math.abs(pct) < 0.5 || METRIC[k].better === "none") return "neutral"
  return (pct > 0) === (METRIC[k].better === "up") ? "good" : "bad"
}

/**
 * Why a metric moved, as the two parts that make it up (like Optmyzr's PPC Investigator):
 * clicks = impressions × CTR, results = clicks × conversion rate, spend = clicks × CPC,
 * cost per result = CPC ÷ conversion rate, CTR = clicks ÷ impressions.
 */
export const DRIVERS: Partial<Record<MetricKey, [MetricKey, MetricKey, string]>> = {
  clicks: ["impressions", "ctr", "×"],
  results: ["clicks", "cvr", "×"],
  spend: ["clicks", "cpc", "×"],
  cpr: ["cpc", "cvr", "÷"],
  ctr: ["clicks", "impressions", "÷"],
}

type Row = { platform: Platform; campaign_id: string; campaign_name: string; date: string } & Sums
export type CampaignPerf = { platform: Platform; campaignId: string; name: string; now: Derived; prev: Derived; daily: { date: string; spend: number; results: number }[]; lastSpendDate: string | null }
export type Performance = {
  dataThrough: string
  /** The first day we have data for (the date picker's lower limit, and where All time starts). */
  dataFrom: string
  rangeKey: string
  periods: Periods
  now: Derived
  prev: Derived
  daily: ({ date: string } & Derived)[]
  prevDaily: ({ date: string } & Derived)[]
  platforms: { platform: Platform; now: Derived; prev: Derived }[]
  campaigns: CampaignPerf[]
}

const num = (v: unknown) => Number(v ?? 0)

/**
 * Loads and aggregates one range and the one before it. `platform` narrows everything. Long ranges
 * come back by week or month (`periods.bucket`), so `daily` holds one point per bucket.
 */
export async function getPerformance(supabase: SupabaseClient, clientId: string, opts: { range: RangeSpec; platform?: Platform | null; campaignId?: string | null }): Promise<Performance | null> {
  const { data: range } = await supabase.from("account_data_range").select("data_from, data_through").eq("client_id", clientId)
  const dataThrough = (range ?? []).map((r) => r.data_through as string).sort().at(-1)
  const dataFrom = (range ?? []).map((r) => r.data_from as string).sort()[0]
  if (!dataThrough || !dataFrom) return null
  const p = resolveRange(opts.range, dataThrough, dataFrom)
  const load = async (from: string, to: string, bucket: string) =>
    (await rpcAll(supabase, "campaign_series", { p_client: clientId, p_from: from, p_to: to, p_bucket: bucket }))
      .map((r) => ({ platform: r.platform as Platform, campaign_id: String(r.campaign_id), campaign_name: String(r.campaign_name ?? r.campaign_id), date: String(r.date), spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), conversions: num(r.conversions), leads: num(r.leads) }))
      .filter((r) => (!opts.platform || r.platform === opts.platform) && (!opts.campaignId || r.campaign_id === opts.campaignId)) as Row[]
  const [nowRows, prevRows, recent] = await Promise.all([
    load(p.from, p.to, p.bucket),
    p.compare ? load(p.prevFrom, p.prevTo, p.bucket) : ([] as Row[]),
    // The last few days by day, for "still spending" whatever the range.
    load(addDaysIso(dataThrough, -6), dataThrough, "day"),
  ])

  const sum = (list: Row[]) => list.reduce((s, r) => add(s, r), zero())
  const nowBuckets = bucketsFor(p.from, p.to, p.bucket)
  const prevBuckets = bucketsFor(p.prevFrom, p.prevTo, p.bucket)
  const series = (list: Row[], buckets: string[]) => {
    const by = new Map<string, Row[]>()
    for (const r of list) by.set(r.date, [...(by.get(r.date) ?? []), r])
    return buckets.map((date) => ({ date, ...derive(sum(by.get(date) ?? [])) }))
  }
  const rows = [...nowRows, ...prevRows]
  const lastSpend = new Map<string, string>()
  for (const r of recent) if (r.spend > 0) lastSpend.set(`${r.platform}|${r.campaign_id}`, r.date)

  const platforms = [...new Set(rows.map((r) => r.platform))].map((pl) => ({ platform: pl, now: derive(sum(nowRows.filter((r) => r.platform === pl))), prev: derive(sum(prevRows.filter((r) => r.platform === pl))) }))
  const keys = [...new Set(rows.map((r) => `${r.platform}|${r.campaign_id}`))]
  const campaigns = keys
    .map((k) => {
      const [platform, campaignId] = k.split("|") as [Platform, string]
      const now = nowRows.filter((r) => r.platform === platform && r.campaign_id === campaignId)
      const prev = prevRows.filter((r) => r.platform === platform && r.campaign_id === campaignId)
      return {
        platform,
        campaignId,
        name: (now.at(-1) ?? prev.at(-1))?.campaign_name ?? campaignId,
        now: derive(sum(now)),
        prev: derive(sum(prev)),
        daily: series(now, nowBuckets).map((d) => ({ date: d.date, spend: d.spend, results: d.results })),
        lastSpendDate: lastSpend.get(k) ?? null,
      }
    })
    .filter((c) => c.now.spend > 0 || c.now.impressions > 0 || c.prev.spend > 0)
    .sort((a, b) => b.now.spend - a.now.spend)

  return { dataThrough, dataFrom, rangeKey: encodeRange(opts.range), periods: p, now: derive(sum(nowRows)), prev: derive(sum(prevRows)), daily: series(nowRows, nowBuckets), prevDaily: series(prevRows, prevBuckets), platforms, campaigns }
}
