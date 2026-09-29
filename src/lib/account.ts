import type { SupabaseClient } from "@supabase/supabase-js"
import { addDays } from "@/lib/metrics/ads"
import type { Platform } from "@/lib/metrics/types"
import { rpcAll } from "@/lib/supabase/rpc-all"

/**
 * The Account tab's numbers (Dean, 2026-09-29: a holistic view for account managers): this month to
 * date against the same days last month, overall and per platform, results and cost per result
 * against the client's target, and spend per campaign.
 */
export type Totals = { spend: number; results: number; clicks: number; impressions: number; cpr: number | null }
export type AccountNumbers = {
  dataThrough: string
  month: string // YYYY-MM-01
  daysElapsed: number
  daysInMonth: number
  mtd: Totals
  lastMonthSameDays: Totals
  byPlatform: { platform: Platform; mtd: Totals; lastMonthSameDays: Totals }[]
  campaigns: { platform: Platform; campaignId: string; name: string; spend: number; results: number; cpr: number | null; lastDate: string }[]
}

const num = (v: unknown) => Number(v ?? 0)
const totals = (rows: { spend: number; results: number; clicks: number; impressions: number }[]): Totals => {
  const t = rows.reduce((s, r) => ({ spend: s.spend + r.spend, results: s.results + r.results, clicks: s.clicks + r.clicks, impressions: s.impressions + r.impressions }), { spend: 0, results: 0, clicks: 0, impressions: 0 })
  return { ...t, cpr: t.results > 0 ? t.spend / t.results : null }
}

export async function getAccountNumbers(supabase: SupabaseClient, clientId: string): Promise<AccountNumbers | null> {
  const { data: range } = await supabase.from("account_data_range").select("data_through").eq("client_id", clientId)
  const dataThrough = (range ?? []).map((r) => r.data_through as string).sort().at(-1)
  if (!dataThrough) return null
  const month = `${dataThrough.slice(0, 7)}-01`
  const day = Number(dataThrough.slice(8, 10))
  const lastMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10)
  const lastMonthDays = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 0)).getUTCDate()
  const lastMonthTo = addDays(lastMonth, Math.min(day, lastMonthDays) - 1)
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()

  const [daily, campaigns] = await Promise.all([
    rpcAll(supabase, "platform_daily", { p_client: clientId, p_from: lastMonth, p_to: dataThrough }),
    rpcAll(supabase, "campaign_daily", { p_client: clientId, p_from: month, p_to: dataThrough }),
  ])
  const rows = daily.map((r) => ({ platform: r.platform as Platform, date: String(r.date), spend: num(r.spend), results: num(r.conversions) + num(r.leads), clicks: num(r.clicks), impressions: num(r.impressions) }))
  const inMtd = (d: string) => d >= month && d <= dataThrough
  const inLast = (d: string) => d >= lastMonth && d <= lastMonthTo
  const platforms = [...new Set(rows.map((r) => r.platform))]

  const byCampaign = new Map<string, AccountNumbers["campaigns"][number]>()
  for (const r of campaigns) {
    const key = `${r.platform}|${r.campaign_id}`
    const c = byCampaign.get(key) ?? { platform: r.platform as Platform, campaignId: String(r.campaign_id), name: String(r.campaign_name ?? r.campaign_id), spend: 0, results: 0, cpr: null, lastDate: "" }
    c.spend += num(r.spend)
    c.results += num(r.conversions) + num(r.leads)
    if (num(r.spend) > 0 && String(r.date) > c.lastDate) c.lastDate = String(r.date)
    byCampaign.set(key, c)
  }

  return {
    dataThrough,
    month,
    daysElapsed: day,
    daysInMonth,
    mtd: totals(rows.filter((r) => inMtd(r.date))),
    lastMonthSameDays: totals(rows.filter((r) => inLast(r.date))),
    byPlatform: platforms.map((p) => ({ platform: p, mtd: totals(rows.filter((r) => r.platform === p && inMtd(r.date))), lastMonthSameDays: totals(rows.filter((r) => r.platform === p && inLast(r.date))) })),
    campaigns: [...byCampaign.values()]
      .filter((c) => c.spend > 0)
      .map((c) => ({ ...c, cpr: c.results > 0 ? c.spend / c.results : null }))
      .sort((a, b) => b.spend - a.spend),
  }
}
