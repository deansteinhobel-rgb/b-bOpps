import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { addDays, fatiguedAds, newCreativesThisMonth, rankAds, totals, type AdStat, type DailyRow, type FatigueInput } from "./ads"
import { calculatePacing, type PacingResult } from "./pacing"
import type { Platform } from "./types"

const n = (v: unknown) => Number(v) || 0
const PLATFORMS: Platform[] = ["linkedin", "google_ads", "meta"]

export type PlatformPacing = PacingResult & { platform: Platform; spendMtd: number; budget: number | null; dataThrough: string }

/**
 * Everything the Overview tab shows for one client. Uses the caller's Supabase client, so RLS
 * decides what they can see. Reads only our cache, never Windsor.
 */
export async function getOverview(supabase: SupabaseClient, clientId: string) {
  const [{ data: ranges }, { data: accounts }] = await Promise.all([
    supabase.from("account_data_range").select("platform, external_account_id, data_from, data_through").eq("client_id", clientId),
    supabase.from("client_platform_accounts").select("platform, external_account_id, monthly_budget").eq("client_id", clientId).eq("active", true),
  ])
  if (!ranges?.length) return null

  const dataThrough = ranges.map((r) => r.data_through as string).sort().at(-1)!
  const from60 = addDays(dataThrough, -59)

  const [{ data: dailyRaw }, { data: adRaw }, { data: fatigueRaw }, { data: budgets }] = await Promise.all([
    supabase.rpc("platform_daily", { p_client: clientId, p_from: from60, p_to: dataThrough }),
    supabase.rpc("ad_stats", { p_client: clientId, p_from: addDays(dataThrough, -6), p_to: dataThrough }),
    supabase.rpc("ad_fatigue_inputs", { p_client: clientId }),
    supabase
      .from("client_budgets")
      .select("platform, campaign_id, month, amount")
      .eq("client_id", clientId)
      .eq("campaign_id", "")
      .eq("month", dataThrough.slice(0, 8) + "01"),
  ])

  const daily: DailyRow[] = (dailyRaw ?? []).map((r: Record<string, unknown>) => ({
    platform: r.platform as Platform,
    date: r.date as string,
    spend: n(r.spend),
    impressions: n(r.impressions),
    clicks: n(r.clicks),
    conversions: n(r.conversions),
    leads: n(r.leads),
  }))

  // Pacing per platform, each against its own data-through date.
  const pacing: PlatformPacing[] = []
  for (const platform of PLATFORMS) {
    const platformRanges = ranges.filter((r) => r.platform === platform)
    if (!platformRanges.length) continue
    const through = platformRanges.map((r) => r.data_through as string).sort().at(-1)!
    const monthStart = through.slice(0, 8) + "01"
    const monthBudget = budgets?.find((b) => b.platform === platform)
    const accountBudget = (accounts ?? []).filter((a) => a.platform === platform).reduce((s, a) => s + n(a.monthly_budget), 0)
    const budget = monthBudget ? n(monthBudget.amount) : accountBudget || null
    const spendOn = (d: string) => daily.filter((r) => r.platform === platform && r.date === d).reduce((s, r) => s + r.spend, 0)
    const spendMtd = totals(daily, monthStart, through, platform).spend
    pacing.push({
      platform,
      spendMtd,
      budget,
      dataThrough: through,
      ...calculatePacing({ spendMtd, budget, dataThrough: through, lastTwoDaysSpend: [spendOn(through), spendOn(addDays(through, -1))] }),
    })
  }

  const periods = {
    last7: totals(daily, addDays(dataThrough, -6), dataThrough),
    prev7: totals(daily, addDays(dataThrough, -13), addDays(dataThrough, -7)),
    last30: totals(daily, addDays(dataThrough, -29), dataThrough),
    prev30: totals(daily, from60, addDays(dataThrough, -30)),
  }
  const byPlatform = PLATFORMS.filter((p) => pacing.some((x) => x.platform === p)).map((platform) => ({
    platform,
    last7: totals(daily, addDays(dataThrough, -6), dataThrough, platform),
    last30: totals(daily, addDays(dataThrough, -29), dataThrough, platform),
  }))

  const ads: AdStat[] = (adRaw ?? []).map((r: Record<string, unknown>) => ({
    platform: r.platform as Platform,
    external_account_id: r.external_account_id as string,
    ad_id: r.ad_id as string,
    ad_name: (r.ad_name as string) ?? null,
    campaign_name: (r.campaign_name as string) ?? null,
    spend: n(r.spend),
    impressions: n(r.impressions),
    clicks: n(r.clicks),
    conversions: n(r.conversions),
    leads: n(r.leads),
  }))
  const fatigueRows: FatigueInput[] = (fatigueRaw ?? []).map((r: Record<string, unknown>) => ({
    ...(r as unknown as FatigueInput),
    recent_impressions: n(r.recent_impressions),
    recent_clicks: n(r.recent_clicks),
    recent_spend: n(r.recent_spend),
    early_impressions: n(r.early_impressions),
    early_clicks: n(r.early_clicks),
  }))

  return {
    dataThrough,
    dataFrom: ranges.map((r) => r.data_from as string).sort()[0],
    daily,
    /** Every ad's first-seen date and recent activity (inputs to fatigue / new creatives). */
    adLifetimes: fatigueRows,
    pacing,
    periods,
    byPlatform,
    rankings: rankAds(ads),
    fatigued: fatiguedAds(fatigueRows),
    newCreatives: newCreativesThisMonth(fatigueRows),
  }
}

export type Overview = NonNullable<Awaited<ReturnType<typeof getOverview>>>
