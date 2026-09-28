/** Ad-level rules and period totals. Pure functions: no database or network access. */
import type { Platform } from "./types"

export type AdStat = {
  platform: Platform
  external_account_id: string
  ad_id: string
  ad_name: string | null
  campaign_name: string | null
  spend: number
  impressions: number
  clicks: number
  conversions: number
  leads: number
}

export type RankedAd = AdStat & { results: number; costPerResult: number | null; ctr: number | null }
export type AdRanking = {
  platform: Platform
  basis: "cost_per_result" | "ctr"
  eligible: number
  best: RankedAd | null
  worst: RankedAd | null
}

export const MIN_RESULTS_FOR_CPR = 3

export function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const enrich = (a: AdStat): RankedAd => {
  const results = a.conversions + a.leads
  return {
    ...a,
    results,
    costPerResult: results > 0 ? a.spend / results : null,
    ctr: a.impressions > 0 ? a.clicks / a.impressions : null,
  }
}

/**
 * Best and worst ad per platform (CLAUDE.md): only ads whose spend is strictly above their
 * account's median ad spend are eligible. Rank by cost per result when at least 2 eligible ads
 * have 3+ results (conversions + leads); otherwise rank all eligible ads by CTR.
 */
export function rankAds(ads: AdStat[]): AdRanking[] {
  const byAccount = new Map<string, AdStat[]>()
  for (const a of ads) {
    if (a.spend <= 0) continue
    const key = `${a.platform}|${a.external_account_id}`
    byAccount.set(key, [...(byAccount.get(key) ?? []), a])
  }
  const eligibleByPlatform = new Map<Platform, RankedAd[]>()
  for (const list of byAccount.values()) {
    const m = median(list.map((a) => a.spend))
    for (const a of list) {
      if (a.spend > m) eligibleByPlatform.set(a.platform, [...(eligibleByPlatform.get(a.platform) ?? []), enrich(a)])
    }
  }

  const out: AdRanking[] = []
  for (const [platform, eligible] of eligibleByPlatform) {
    const withResults = eligible.filter((a) => a.results >= MIN_RESULTS_FOR_CPR)
    if (withResults.length >= 2) {
      const sorted = [...withResults].sort((a, b) => a.costPerResult! - b.costPerResult!)
      out.push({ platform, basis: "cost_per_result", eligible: eligible.length, best: sorted[0], worst: sorted.at(-1)! })
      continue
    }
    const sorted = eligible.filter((a) => a.ctr !== null).sort((a, b) => b.ctr! - a.ctr!)
    out.push({
      platform,
      basis: "ctr",
      eligible: eligible.length,
      best: sorted[0] ?? null,
      worst: sorted.length > 1 ? sorted.at(-1)! : null,
    })
  }
  return out.sort((a, b) => a.platform.localeCompare(b.platform))
}

export type FatigueInput = {
  platform: Platform
  external_account_id: string
  ad_id: string
  ad_name: string | null
  campaign_name: string | null
  first_seen: string
  data_from: string
  data_through: string
  live: boolean
  recent_impressions: number
  recent_clicks: number
  recent_spend: number
  early_impressions: number
  early_clicks: number
}

export type FatiguedAd = FatigueInput & {
  ageDays: number
  /** first_seen is the start of our cache, so the ad may be older than shown. */
  firstSeenCapped: boolean
  recentCtr: number | null
  earlyCtr: number | null
  ctrChangePct: number | null
}

export const FATIGUE_MIN_AGE_DAYS = 45

export const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5)

/** Live ads first seen 45+ days before the data-through date. Biggest recent spenders first. */
export function fatiguedAds(rows: FatigueInput[], minAgeDays = FATIGUE_MIN_AGE_DAYS): FatiguedAd[] {
  return rows
    .filter((r) => r.live && dayDiff(r.first_seen, r.data_through) >= minAgeDays)
    .map((r) => {
      const recentCtr = r.recent_impressions > 0 ? r.recent_clicks / r.recent_impressions : null
      const earlyCtr = r.early_impressions > 0 ? r.early_clicks / r.early_impressions : null
      return {
        ...r,
        ageDays: dayDiff(r.first_seen, r.data_through),
        firstSeenCapped: r.first_seen <= r.data_from,
        recentCtr,
        earlyCtr,
        ctrChangePct: recentCtr !== null && earlyCtr ? Math.round((recentCtr / earlyCtr - 1) * 100) : null,
      }
    })
    .sort((a, b) => b.recent_spend - a.recent_spend)
}

/** Ads first seen in the calendar month of the data-through date (not ones already there at backfill). */
export function newCreativesThisMonth(rows: FatigueInput[]): FatigueInput[] {
  return rows
    .filter((r) => r.first_seen >= r.data_through.slice(0, 8) + "01" && r.first_seen > r.data_from)
    .sort((a, b) => b.first_seen.localeCompare(a.first_seen))
}

export type DailyRow = { platform: Platform; date: string; spend: number; impressions: number; clicks: number; conversions: number; leads: number }
export type Totals = { spend: number; impressions: number; clicks: number; conversions: number; leads: number; results: number; costPerResult: number | null; ctr: number | null }

export function totals(rows: DailyRow[], from: string, to: string, platform?: Platform): Totals {
  const t = { spend: 0, impressions: 0, clicks: 0, conversions: 0, leads: 0 }
  for (const r of rows) {
    if (r.date < from || r.date > to || (platform && r.platform !== platform)) continue
    t.spend += r.spend
    t.impressions += r.impressions
    t.clicks += r.clicks
    t.conversions += r.conversions
    t.leads += r.leads
  }
  const results = t.conversions + t.leads
  return { ...t, results, costPerResult: results > 0 ? t.spend / results : null, ctr: t.impressions > 0 ? t.clicks / t.impressions : null }
}

export const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10)

export const pctChange = (cur: number | null, prev: number | null) =>
  cur === null || prev === null || prev === 0 ? null : Math.round((cur / prev - 1) * 1000) / 10
