import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { addDays, adHealth, fatiguedAds, newCreativesThisMonth, rankAds, totals, type AdStat, type DailyRow, type FatigueInput } from "./ads"
import { calculatePacing, type PacingResult } from "./pacing"
import type { Platform } from "./types"

const n = (v: unknown) => Number(v) || 0
const PLATFORMS: Platform[] = ["linkedin", "google_ads", "meta"]

export type PlatformPacing = PacingResult & {
  platform: Platform
  spendMtd: number
  budget: number | null
  /** Where the budget came from: this month's own budget, or the accounts' default monthly budget. */
  budgetSource: "month" | "default" | null
  dataThrough: string
}

export type CampaignPacing = PacingResult & {
  platform: Platform
  campaignId: string
  campaignName: string
  spendMtd: number
  budget: number | null
}

type Range = { platform: string; external_account_id: string; data_from: string; data_through: string }
type AccountBudget = { platform: string; monthly_budget: number | string | null }
type MonthBudget = { platform: string; month: string; amount: number | string }

const budgetsQuery = (supabase: SupabaseClient, clientId: string) =>
  supabase.from("client_budgets").select("platform, month, amount").eq("client_id", clientId).eq("campaign_id", "")

function toDaily(raw: unknown): DailyRow[] {
  return ((raw as Record<string, unknown>[] | null) ?? []).map((r) => ({
    platform: r.platform as Platform,
    date: r.date as string,
    spend: n(r.spend),
    impressions: n(r.impressions),
    clicks: n(r.clicks),
    conversions: n(r.conversions),
    leads: n(r.leads),
  }))
}

/**
 * Pacing per platform, each against its own data-through date and that month's budget
 * (client_budgets for the month, else the accounts' default monthly budgets).
 */
function pacingFor(ranges: Range[], accounts: AccountBudget[], budgets: MonthBudget[], daily: DailyRow[]): PlatformPacing[] {
  const out: PlatformPacing[] = []
  for (const platform of PLATFORMS) {
    const platformRanges = ranges.filter((r) => r.platform === platform)
    if (!platformRanges.length) continue
    const through = platformRanges.map((r) => r.data_through).sort().at(-1)!
    const monthStart = through.slice(0, 8) + "01"
    const monthBudget = budgets.find((b) => b.platform === platform && b.month === monthStart)
    const accountBudget = accounts.filter((a) => a.platform === platform).reduce((s, a) => s + n(a.monthly_budget), 0)
    const budget = monthBudget ? n(monthBudget.amount) : accountBudget || null
    const budgetSource = monthBudget ? ("month" as const) : accountBudget ? ("default" as const) : null
    const spendOn = (d: string) => daily.filter((r) => r.platform === platform && r.date === d).reduce((s, r) => s + r.spend, 0)
    const spendMtd = totals(daily, monthStart, through, platform).spend
    out.push({
      platform,
      spendMtd,
      budget,
      budgetSource,
      dataThrough: through,
      ...calculatePacing({ spendMtd, budget, dataThrough: through, lastTwoDaysSpend: [spendOn(through), spendOn(addDays(through, -1))] }),
    })
  }
  return out
}

/** Pacing only: the lighter query set used by the client list cards. */
export async function getPacing(supabase: SupabaseClient, clientId: string): Promise<{ dataThrough: string; pacing: PlatformPacing[] } | null> {
  const [{ data: ranges }, { data: accounts }, { data: budgets }] = await Promise.all([
    supabase.from("account_data_range").select("platform, external_account_id, data_from, data_through").eq("client_id", clientId),
    supabase.from("client_platform_accounts").select("platform, monthly_budget").eq("client_id", clientId).eq("active", true),
    budgetsQuery(supabase, clientId),
  ])
  if (!ranges?.length) return null
  const dataThrough = ranges.map((r) => r.data_through as string).sort().at(-1)!
  const from = addDays(ranges.map((r) => (r.data_through as string).slice(0, 8) + "01").sort()[0], -1)
  const { data: dailyRaw } = await supabase.rpc("platform_daily", { p_client: clientId, p_from: from, p_to: dataThrough })
  return { dataThrough, pacing: pacingFor(ranges as Range[], accounts ?? [], budgets ?? [], toDaily(dailyRaw)) }
}

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
  const typedRanges = ranges as Range[]

  const dataThrough = ranges.map((r) => r.data_through as string).sort().at(-1)!
  const from60 = addDays(dataThrough, -59)

  const monthStart = dataThrough.slice(0, 8) + "01"
  const [{ data: dailyRaw }, { data: adRaw }, { data: fatigueRaw }, { data: budgets }, { data: campaignRaw }, { data: campaignBudgets }] = await Promise.all([
    supabase.rpc("platform_daily", { p_client: clientId, p_from: from60, p_to: dataThrough }),
    supabase.rpc("ad_stats", { p_client: clientId, p_from: addDays(dataThrough, -6), p_to: dataThrough }),
    supabase.rpc("ad_fatigue_inputs", { p_client: clientId }),
    budgetsQuery(supabase, clientId),
    supabase.rpc("campaign_month", { p_client: clientId, p_from: monthStart, p_to: dataThrough }),
    supabase.from("client_budgets").select("platform, campaign_id, amount").eq("client_id", clientId).eq("month", monthStart).neq("campaign_id", ""),
  ])

  const daily = toDaily(dailyRaw)
  const pacing = pacingFor(typedRanges, accounts ?? [], budgets ?? [], daily)

  // Per campaign, this month: pacing against the campaign's own budget where one is set.
  const campaignPacing: CampaignPacing[] = ((campaignRaw ?? []) as Record<string, unknown>[]).map((c) => {
    const platform = c.platform as Platform
    const budgetRow = (campaignBudgets ?? []).find((b) => b.platform === platform && b.campaign_id === c.campaign_id)
    const budget = budgetRow ? n(budgetRow.amount) : null
    const spendMtd = n(c.spend)
    const through = pacing.find((p) => p.platform === platform)?.dataThrough ?? dataThrough
    const last2 = n(c.spend_last2)
    return {
      platform,
      campaignId: c.campaign_id as string,
      campaignName: (c.campaign_name as string) ?? (c.campaign_id as string),
      spendMtd,
      budget,
      ...calculatePacing({ spendMtd, budget, dataThrough: through.slice(0, 7) === monthStart.slice(0, 7) ? through : dataThrough, lastTwoDaysSpend: [last2, last2] }),
    }
  })

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
    recent_conversions: n(r.recent_conversions),
    recent_leads: n(r.recent_leads),
    early_clicks: n(r.early_clicks),
    early_spend: n(r.early_spend),
    early_conversions: n(r.early_conversions),
    early_leads: n(r.early_leads),
  }))
  const liveAds = adHealth(fatigueRows)

  return {
    dataThrough,
    dataFrom: ranges.map((r) => r.data_from as string).sort()[0],
    daily,
    /** Every ad's first-seen date and recent activity (inputs to fatigue / new creatives). */
    adLifetimes: fatigueRows,
    pacing,
    campaignPacing,
    month: monthStart,
    periods,
    byPlatform,
    rankings: rankAds(ads),
    /** Every live ad, first 14 vs last 14 days (the Overview's ad fatigue tiles). */
    liveAds,
    fatigued: fatiguedAds(fatigueRows),
    newCreatives: newCreativesThisMonth(fatigueRows),
  }
}

export type Overview = NonNullable<Awaited<ReturnType<typeof getOverview>>>
