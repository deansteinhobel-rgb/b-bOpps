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
 * Eligible ads per platform, best first (CLAUDE.md): only ads whose spend is strictly above their
 * account's median ad spend are eligible. Rank by cost per result when at least 2 eligible ads
 * have 3+ results (conversions + leads); otherwise rank all eligible ads by CTR.
 */
function rankedByPlatform(ads: AdStat[]): { platform: Platform; basis: AdRanking["basis"]; eligible: number; ranked: RankedAd[] }[] {
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
  return [...eligibleByPlatform]
    .map(([platform, eligible]) => {
      const withResults = eligible.filter((a) => a.results >= MIN_RESULTS_FOR_CPR)
      return withResults.length >= 2
        ? { platform, basis: "cost_per_result" as const, eligible: eligible.length, ranked: [...withResults].sort((a, b) => a.costPerResult! - b.costPerResult!) }
        : { platform, basis: "ctr" as const, eligible: eligible.length, ranked: eligible.filter((a) => a.ctr !== null).sort((a, b) => b.ctr! - a.ctr!) }
    })
    .sort((a, b) => a.platform.localeCompare(b.platform))
}

/** Best and worst ad per platform (see rankedByPlatform for the rule). */
export function rankAds(ads: AdStat[]): AdRanking[] {
  return rankedByPlatform(ads).map(({ platform, basis, eligible, ranked }) => ({
    platform,
    basis,
    eligible,
    best: ranked[0] ?? null,
    worst: basis === "cost_per_result" || ranked.length > 1 ? ranked.at(-1)! : null,
  }))
}

/** The top ads per platform by the same rule, at most `n` and never more than the better half. */
export function topAds(ads: AdStat[], n = 3): { platform: Platform; basis: AdRanking["basis"]; ads: RankedAd[] }[] {
  return rankedByPlatform(ads)
    .filter((r) => r.ranked.length > 0)
    .map(({ platform, basis, ranked }) => ({ platform, basis, ads: ranked.slice(0, Math.min(n, Math.max(1, Math.floor(ranked.length / 2)))) }))
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
  /** Last 14 days to data-through. */
  recent_impressions: number
  recent_clicks: number
  recent_spend: number
  recent_conversions: number
  recent_leads: number
  /** The ad's first 14 days. */
  early_impressions: number
  early_clicks: number
  early_spend: number
  early_conversions: number
  early_leads: number
}

export type FatiguedAd = FatigueInput & {
  ageDays: number
  /** first_seen is the start of our cache, so the ad may be older than shown. */
  firstSeenCapped: boolean
  /** Older than AD_OLD_DAYS (shown in red). */
  old: boolean
  /** Its first 14 days and last 14 days don't overlap and the first 14 are in our data. */
  comparable: boolean
  recentCtr: number | null
  earlyCtr: number | null
  ctrChangePct: number | null
  /** CTR in the last 14 days is below its first 14 days. */
  ctrDown: boolean
  recentCpr: number | null
  earlyCpr: number | null
  cprChangePct: number | null
  /** Cost per result in the last 14 days is above its first 14 days (or spend with no results). */
  cprUp: boolean
}

export const FATIGUE_MIN_AGE_DAYS = 45
/** Ads first seen more than this many days ago show their first-seen date in red (Dean). */
export const AD_OLD_DAYS = 30
const WINDOW = 14

export const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5)

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
const change = (now: number | null, then: number | null) => (now !== null && then ? Math.round((now / then - 1) * 100) : null)

/** Every live ad with its first-14 vs last-14 day CTR and cost per result. Biggest recent spenders first. */
export function adHealth(rows: FatigueInput[]): FatiguedAd[] {
  return rows
    .filter((r) => r.live)
    .map((r) => {
      const ageDays = dayDiff(r.first_seen, r.data_through)
      const firstSeenCapped = r.first_seen <= r.data_from
      const comparable = !firstSeenCapped && ageDays >= WINDOW * 2 - 1
      const recentCtr = ratio(r.recent_clicks, r.recent_impressions)
      const earlyCtr = ratio(r.early_clicks, r.early_impressions)
      const recentResults = r.recent_conversions + r.recent_leads
      const earlyResults = r.early_conversions + r.early_leads
      const recentCpr = ratio(r.recent_spend, recentResults)
      const earlyCpr = ratio(r.early_spend, earlyResults)
      return {
        ...r,
        ageDays,
        firstSeenCapped,
        old: ageDays > AD_OLD_DAYS,
        comparable,
        recentCtr,
        earlyCtr,
        ctrChangePct: comparable ? change(recentCtr, earlyCtr) : null,
        ctrDown: comparable && recentCtr !== null && earlyCtr !== null && recentCtr < earlyCtr,
        recentCpr,
        earlyCpr,
        cprChangePct: comparable ? change(recentCpr, earlyCpr) : null,
        cprUp: comparable && earlyCpr !== null && (recentCpr === null ? r.recent_spend > 0 : recentCpr > earlyCpr),
      }
    })
    .sort((a, b) => b.recent_spend - a.recent_spend)
}

/** Live ads first seen 45+ days before the data-through date (the fatigue check). Biggest recent spenders first. */
export function fatiguedAds(rows: FatigueInput[], minAgeDays = FATIGUE_MIN_AGE_DAYS): FatiguedAd[] {
  return adHealth(rows).filter((a) => a.ageDays >= minAgeDays)
}

/**
 * Live ads that look tired (the Overview tiles' rule): over AD_OLD_DAYS live and worse on CTR or cost
 * per result in their last 14 days than their first 14. Worse on both first, then by recent spend.
 */
export function tiringAds(live: FatiguedAd[]): FatiguedAd[] {
  return live
    .filter((a) => a.old && (a.ctrDown || a.cprUp))
    .sort((a, b) => Number(b.ctrDown && b.cprUp) - Number(a.ctrDown && a.cprUp) || b.recent_spend - a.recent_spend)
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
