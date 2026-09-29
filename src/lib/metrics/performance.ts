import type { SupabaseClient } from "@supabase/supabase-js"
import { money, percent, whole } from "@/lib/format"
import { rpcAll } from "@/lib/supabase/rpc-all"
import { addDays } from "./ads"
import type { Platform } from "./types"

/** The Performance tab's numbers: a period against the one before it, per platform and campaign. */

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

export type Periods = { from: string; to: string; prevFrom: string; prevTo: string; days: number }
export function periodsFor(dataThrough: string, days: number): Periods {
  const to = dataThrough
  const from = addDays(to, -(days - 1))
  return { from, to, prevTo: addDays(from, -1), prevFrom: addDays(from, -days), days }
}

type Row = { platform: Platform; campaign_id: string; campaign_name: string; date: string } & Sums
export type CampaignPerf = { platform: Platform; campaignId: string; name: string; now: Derived; prev: Derived; daily: { date: string; spend: number; results: number }[]; lastSpendDate: string | null }
export type Performance = {
  dataThrough: string
  periods: Periods
  now: Derived
  prev: Derived
  daily: ({ date: string } & Derived)[]
  prevDaily: ({ date: string } & Derived)[]
  platforms: { platform: Platform; now: Derived; prev: Derived }[]
  campaigns: CampaignPerf[]
}

const num = (v: unknown) => Number(v ?? 0)

/** Loads and aggregates one period and the one before it. `platform` narrows everything. */
export async function getPerformance(supabase: SupabaseClient, clientId: string, opts: { days: number; platform?: Platform | null; campaignId?: string | null }): Promise<Performance | null> {
  const { data: range } = await supabase.from("account_data_range").select("data_through").eq("client_id", clientId)
  const dataThrough = (range ?? []).map((r) => r.data_through as string).sort().at(-1)
  if (!dataThrough) return null
  const p = periodsFor(dataThrough, opts.days)
  const data = await rpcAll(supabase, "campaign_daily", { p_client: clientId, p_from: p.prevFrom, p_to: p.to })
  const rows = data
    .map((r) => ({ platform: r.platform as Platform, campaign_id: String(r.campaign_id), campaign_name: String(r.campaign_name ?? r.campaign_id), date: String(r.date), spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), conversions: num(r.conversions), leads: num(r.leads) }))
    .filter((r) => (!opts.platform || r.platform === opts.platform) && (!opts.campaignId || r.campaign_id === opts.campaignId)) as Row[]

  const inNow = (d: string) => d >= p.from && d <= p.to
  const sum = (list: Row[]) => list.reduce((s, r) => add(s, r), zero())
  const nowRows = rows.filter((r) => inNow(r.date))
  const prevRows = rows.filter((r) => !inNow(r.date))
  const byDay = (list: Row[], from: string, days: number) =>
    Array.from({ length: days }, (_, i) => {
      const date = addDays(from, i)
      return { date, ...derive(sum(list.filter((r) => r.date === date))) }
    })

  const platforms = [...new Set(rows.map((r) => r.platform))].map((pl) => ({ platform: pl, now: derive(sum(nowRows.filter((r) => r.platform === pl))), prev: derive(sum(prevRows.filter((r) => r.platform === pl))) }))
  const keys = [...new Set(rows.map((r) => `${r.platform}|${r.campaign_id}`))]
  const campaigns = keys
    .map((k) => {
      const [platform, campaignId] = k.split("|") as [Platform, string]
      const mine = rows.filter((r) => r.platform === platform && r.campaign_id === campaignId)
      const now = mine.filter((r) => inNow(r.date))
      const spent = mine.filter((r) => r.spend > 0).map((r) => r.date).sort()
      return {
        platform,
        campaignId,
        name: mine.at(-1)?.campaign_name ?? campaignId,
        now: derive(sum(now)),
        prev: derive(sum(mine.filter((r) => !inNow(r.date)))),
        daily: Array.from({ length: p.days }, (_, i) => {
          const date = addDays(p.from, i)
          const s = derive(sum(now.filter((r) => r.date === date)))
          return { date, spend: s.spend, results: s.results }
        }),
        lastSpendDate: spent.at(-1) ?? null,
      }
    })
    .filter((c) => c.now.spend > 0 || c.now.impressions > 0 || c.prev.spend > 0)
    .sort((a, b) => b.now.spend - a.now.spend)

  return { dataThrough, periods: p, now: derive(sum(nowRows)), prev: derive(sum(prevRows)), daily: byDay(nowRows, p.from, p.days), prevDaily: byDay(prevRows, p.prevFrom, p.days), platforms, campaigns }
}
