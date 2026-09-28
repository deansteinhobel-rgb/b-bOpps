/**
 * Change suggestions from Windsor, so most of a sprint's change log fills itself. The team logs
 * or dismisses each one; nothing is logged automatically. Pure functions: no database access.
 */
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"

export type AdEvent = {
  platform: Platform
  ad_id: string
  ad_name: string | null
  campaign_name: string | null
  first_seen: string
  last_seen: string
  data_through: string
  spend_in_range: number
}
export type DailySpend = { platform: Platform; date: string; spend: number }

export type Suggestion = {
  key: string
  changed_on: string
  platform: Platform
  campaign_name: string | null
  type: "creative" | "budget"
  description: string
}

export const SPEND_SHIFT_PCT = 30
export const MIN_WEEKLY_SPEND = 100

const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export function suggestChanges(opts: { events: AdEvent[]; daily: DailySpend[]; from: string; to: string; currency: string }): Suggestion[] {
  const money = (v: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: opts.currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(v)
  const out: Suggestion[] = []

  // New ads, grouped by platform + campaign + day.
  const launched = new Map<string, AdEvent[]>()
  for (const e of opts.events) {
    if (e.first_seen < opts.from || e.first_seen > opts.to) continue
    const k = `${e.platform}|${e.campaign_name ?? ""}|${e.first_seen}`
    launched.set(k, [...(launched.get(k) ?? []), e])
  }
  for (const [k, list] of launched) {
    const e = list[0]
    out.push({
      key: `new|${k}`,
      changed_on: e.first_seen,
      platform: e.platform,
      campaign_name: e.campaign_name,
      type: "creative",
      description: `${plural(list.length, `new ${PLATFORM_LABEL[e.platform]} ad`)} launched${e.campaign_name ? ` in “${e.campaign_name}”` : ""}${list.length <= 3 ? `: ${list.map((a) => a.ad_name ?? a.ad_id).join("; ")}` : ""}`,
    })
  }

  // Ads that stopped running (last impressions in the range, not live now, and spent something).
  const stopped = new Map<string, AdEvent[]>()
  for (const e of opts.events) {
    if (e.last_seen < opts.from || e.last_seen > opts.to || e.last_seen >= addDays(e.data_through, -1) || e.spend_in_range <= 0) continue
    const k = `${e.platform}|${e.campaign_name ?? ""}|${e.last_seen}`
    stopped.set(k, [...(stopped.get(k) ?? []), e])
  }
  for (const [k, list] of stopped) {
    const e = list[0]
    out.push({
      key: `stop|${k}`,
      changed_on: addDays(e.last_seen, 1),
      platform: e.platform,
      campaign_name: e.campaign_name,
      type: "creative",
      description: `${plural(list.length, `${PLATFORM_LABEL[e.platform]} ad`)} stopped running${e.campaign_name ? ` in “${e.campaign_name}”` : ""}${list.length <= 3 ? `: ${list.map((a) => a.ad_name ?? a.ad_id).join("; ")}` : ""}`,
    })
  }

  // Week-on-week spend shifts per platform, for each complete week of the range we have data for.
  const platforms = [...new Set(opts.daily.map((d) => d.platform))]
  const lastDate = opts.daily.map((d) => d.date).sort().at(-1) ?? opts.from
  for (let weekStart = opts.from; addDays(weekStart, 6) <= opts.to && addDays(weekStart, 6) <= lastDate; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6)
    const prevStart = addDays(weekStart, -7)
    for (const p of platforms) {
      const sum = (a: string, b: string) => opts.daily.filter((d) => d.platform === p && d.date >= a && d.date <= b).reduce((s, d) => s + d.spend, 0)
      const now = sum(weekStart, weekEnd)
      const prev = sum(prevStart, addDays(weekStart, -1))
      if (now < MIN_WEEKLY_SPEND && prev < MIN_WEEKLY_SPEND) continue
      const pct = prev > 0 ? Math.round((now / prev - 1) * 100) : null
      if (pct !== null && Math.abs(pct) < SPEND_SHIFT_PCT) continue
      out.push({
        key: `spend|${p}|${weekStart}`,
        changed_on: weekStart,
        platform: p,
        campaign_name: null,
        type: "budget",
        description: `${PLATFORM_LABEL[p]} spend ${pct === null ? "started" : pct > 0 ? `up ${pct}%` : `down ${Math.abs(pct)}%`} week on week (${money(prev)} → ${money(now)})`,
      })
    }
  }
  return out.sort((a, b) => b.changed_on.localeCompare(a.changed_on))
}
