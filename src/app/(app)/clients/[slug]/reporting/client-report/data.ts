import type { SupabaseClient } from "@supabase/supabase-js"
import { cachedPerformance } from "@/lib/metrics/cached"
import { pickAds, reportSummary, type AdPicks } from "@/lib/metrics/client-report"
import { assetSentence, pickAssets, type AssetSection } from "@/lib/metrics/assets"
import { campaignAssets } from "@/lib/metrics/breakdowns"
import type { Derived, Periods } from "@/lib/metrics/performance"
import { isPlatform, PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import type { RangeSpec } from "@/lib/metrics/range"
import { previewsFor, type PreviewMap } from "@/lib/previews"
import { loadTargets, targetFor } from "@/lib/targets"
import { adsForPeriod } from "../boards"

/**
 * Loading the client report (Dean, 2026-10-19), for the app page and the shared link alike.
 *
 * SECURITY: uses the cached numbers (admin client). The caller must have confirmed access first: the
 * app page loads the client through RLS, the shared link by its secret token.
 */

export type CampaignPick = { platform: Platform; id: string }
export type ReportScope = { platform: Platform | null; campaign: CampaignPick | null }

/** URL values: `platform` = "all" or a platform; `campaign` = "all" or "<platform>:<campaign id>". */
export const parsePlatformStep = (v: unknown): Platform | "all" | null => (v === "all" ? "all" : isPlatform(v) ? v : null)
export function parseCampaignStep(v: unknown): CampaignPick | "all" | null {
  if (v === "all") return "all"
  if (typeof v !== "string") return null
  const i = v.indexOf(":")
  const platform = v.slice(0, i)
  const id = v.slice(i + 1)
  return i > 0 && isPlatform(platform) && id && id.length <= 100 ? { platform, id } : null
}
export const campaignValue = (c: CampaignPick) => `${c.platform}:${c.id}`

/**
 * A shared link's scope (Dean, 2026-10-19: each campaign can be reviewed). The viewer may open one
 * platform or one campaign inside what the link covers, never anything wider: a link to one
 * campaign stays on it, a link to one platform only opens that platform's campaigns.
 */
export function sharedScope(link: { board: string; campaign_id?: string | null }, sp: Record<string, unknown>): ReportScope & { drilled: boolean } {
  const base = isPlatform(link.board) ? link.board : null
  if (base && link.campaign_id) return { platform: base, campaign: { platform: base, id: String(link.campaign_id) }, drilled: false }
  const c = parseCampaignStep(sp.campaign)
  if (c && c !== "all" && (!base || c.platform === base)) return { platform: base, campaign: c, drilled: true }
  const p = base ? null : parsePlatformStep(sp.platform)
  if (p && p !== "all") return { platform: p, campaign: null, drilled: true }
  return { platform: base, campaign: null, drilled: false }
}

/**
 * The browser tab's title (Dean, 2026-10-19): "Platform | Campaign", e.g. "Google Ads | DG | Search |
 * Non-Brand Core" or "LinkedIn | All campaigns". Null until the platform and campaign are picked.
 */
export async function reportTabTitle(db: SupabaseClient, clientId: string, platform: Platform | null, campaign: CampaignPick | "all" | null): Promise<string | null> {
  if (!campaign) return null
  const p = campaign === "all" ? platform : campaign.platform
  const left = p ? PLATFORM_LABEL[p] : "All platforms"
  if (campaign === "all") return `${left} | All campaigns`
  // The campaign's latest name (one row; RLS applies to the caller's client).
  const { data } = await db.from("windsor_daily_metrics").select("campaign_name").eq("client_id", clientId).eq("platform", campaign.platform).eq("campaign_id", campaign.id).order("date", { ascending: false }).limit(1).maybeSingle()
  return `${left} | ${data?.campaign_name ?? "Campaign"}`
}

/** A row of the by-platform or by-campaign breakdown. `value` opens that report (a platform or "<platform>:<id>"). */
export type BreakdownRow = { value: string; platform: Platform; name: string; now: Derived; prev: Derived }

/**
 * The client's business goal for the months the report's dates touch (Dean, 2026-10-19: DNSFilter's
 * activated free trials come first on the overall report). One figure per month, entered by the team
 * (client_goals); the month in progress is "so far", with where on-pace would be today.
 */
export type GoalMonth = { month: string; label: string; value: number | null; target: number | null; inProgress: boolean; expected: number | null }
export type ReportGoal = { name: string; months: GoalMonth[] }

const monthLabel = (m: string, year: boolean) => new Intl.DateTimeFormat("en-GB", { month: "long", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(m))

export async function loadGoals(db: SupabaseClient, clientId: string, from: string, to: string, today: string): Promise<ReportGoal[]> {
  // Every month from the one `from` is in to the one `to` is in, newest first (at most 6).
  const months: string[] = []
  for (let y = Number(to.slice(0, 4)), m = Number(to.slice(5, 7)); months.length < 6; m--) {
    if (m === 0) {
      m = 12
      y--
    }
    const key = `${y}-${String(m).padStart(2, "0")}-01`
    if (key < `${from.slice(0, 7)}-01`) break
    months.push(key)
  }
  const { data: goals } = await db.from("client_goals").select("id, name, monthly_target, client_goal_values(month, value, target)").eq("client_id", clientId).eq("active", true).order("position")
  const thisMonth = `${today.slice(0, 7)}-01`
  const day = Number(today.slice(8, 10))
  const daysIn = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()
  const oneYear = months.every((m) => m.slice(0, 4) === today.slice(0, 4))
  return (goals ?? []).map((g) => {
    const values = (g.client_goal_values ?? []) as { month: string; value: number | string; target: number | string | null }[]
    return {
      name: g.name,
      months: months.map((month) => {
        const v = values.find((x) => x.month === month)
        const target = v?.target != null ? Number(v.target) : g.monthly_target != null ? Number(g.monthly_target) : null
        const inProgress = month === thisMonth
        return { month, label: monthLabel(month, !oneYear), value: v ? Number(v.value) : null, target, inProgress, expected: inProgress && target ? Math.round((target * day) / daysIn) : null }
      }),
    }
  })
}

export type CampaignOption = { value: string; platform: Platform; name: string; spend: number; results: number }
export type ClientReportData = {
  scope: ReportScope
  /** "LinkedIn", "All platforms", or the campaign's name. */
  title: string
  /** The platform the numbers are judged on (the campaign's, when one is picked). */
  platform: Platform | null
  periods: Periods
  dataFrom: string
  dataThrough: string
  now: Derived
  prev: Derived
  target: number | null
  picks: AdPicks
  /** All platforms and all campaigns: the overall report (4 headline numbers, by platform, top and weakest 3). */
  overall: boolean
  goals: ReportGoal[]
  /** With all campaigns: one row per platform (overall only) and one per campaign. */
  byPlatform: BreakdownRow[]
  byCampaign: BreakdownRow[]
  /** Ads that spent in the scope (0 = the campaign reports no ads, e.g. Performance Max). */
  adsWithSpend: number
  /**
   * One Performance Max or Demand Gen campaign picked: its top and weakest images and headlines,
   * shown in place of ads (PMax has no ad rows; Demand Gen ads have no image). Null otherwise.
   */
  assets: AssetSection[] | null
  summary: string[]
  previews: PreviewMap
  /** For the builder: the platforms with spend in the period, and the campaigns in the picked platform. */
  platforms: { platform: Platform; spend: number }[]
  campaigns: CampaignOption[]
}

export async function loadClientReport(db: SupabaseClient, client: { id: string; currency: string; monthly_kpi_target: unknown }, scope: ReportScope, range: RangeSpec): Promise<ClientReportData | null> {
  const camp = scope.campaign
  const platform = camp?.platform ?? scope.platform
  const [all, wide, targets] = await Promise.all([
    cachedPerformance(client.id, range, null),
    // The campaigns to pick from (and the campaign lines in the summary): the picked platform's, or everyone's.
    scope.platform ? cachedPerformance(client.id, range, scope.platform) : null,
    loadTargets(db, client.id, client.monthly_kpi_target),
  ])
  if (!all) return null
  const list = wide ?? all
  const perf = camp ? await cachedPerformance(client.id, range, camp.platform, camp.id) : list
  if (!perf) return null
  // When the picked campaign didn't spend in these dates, it still has a name from the period before.
  const campaign = camp ? (list.campaigns.find((c) => c.platform === camp.platform && c.campaignId === camp.id) ?? perf.campaigns[0] ?? null) : null
  const { from, to } = perf.periods
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date())

  const [allAds, assetData] = await Promise.all([
    adsForPeriod(db, client.id, from, to),
    camp?.platform === "google_ads" ? campaignAssets(db, client.id, camp.id, from, to) : null,
  ])
  const ads = allAds.filter((a) => (!platform || a.platform === platform) && (!camp || a.campaign_id === camp.id))
  const assetSections = assetData?.source ? pickAssets(assetData.assets, 3) : []
  const assets = assetSections.length ? assetSections : null
  const overall = !platform && !camp
  // One PMax or Demand Gen campaign: its assets stand in for the ads.
  const picks = pickAds(assets ? [] : ads, overall ? { results: 3, ctr: 0, weak: 3 } : { results: 2, ctr: 2, weak: 3 })
  const shown = [...picks.byResults, ...picks.byCtr, ...picks.worst]
  // The client never gets the team's "Add the post link" button.
  const previews = Object.fromEntries(Object.entries(await previewsFor(db, client.id, shown)).map(([k, p]) => [k, { ...p, addPost: null }]))

  const title = campaign?.name ?? (camp ? "Campaign" : platform ? PLATFORM_LABEL[platform] : "All platforms")
  const target = targetFor(targets, platform)
  const summary = reportSummary({
    scope: camp ? (campaign ? `“${campaign.name}”` : "The campaign") : platform ? `${PLATFORM_LABEL[platform]} advertising` : "Paid media",
    oneCampaign: Boolean(camp),
    platform,
    currency: client.currency,
    compare: perf.periods.compare,
    now: perf.now,
    prev: perf.prev,
    target,
    campaigns: list.campaigns,
    best: picks.byResults[0] ?? picks.byCtr[0] ?? null,
    basis: picks.byResults.length ? "cost_per_result" : "ctr",
  })
  for (const a of assets ?? []) {
    const line = assetSentence(a, client.currency)
    if (line) summary.push(line)
  }

  return {
    scope: { platform: scope.platform, campaign: camp },
    title,
    platform,
    periods: perf.periods,
    dataFrom: perf.dataFrom,
    dataThrough: perf.dataThrough,
    now: perf.now,
    prev: perf.prev,
    target,
    picks,
    overall,
    goals: overall ? await loadGoals(db, client.id, from, to, today) : [],
    byPlatform: overall
      ? all.platforms.filter((p) => p.now.spend > 0 || p.prev.spend > 0).sort((a, b) => b.now.spend - a.now.spend).map((p) => ({ value: p.platform, platform: p.platform, name: PLATFORM_LABEL[p.platform], now: p.now, prev: p.prev }))
      : [],
    byCampaign: camp
      ? []
      : list.campaigns.filter((c) => c.now.spend > 0).map((c) => ({ value: campaignValue({ platform: c.platform, id: c.campaignId }), platform: c.platform, name: c.name, now: c.now, prev: c.prev })),
    adsWithSpend: ads.filter((a) => a.spend > 0).length,
    assets,
    summary,
    previews,
    platforms: all.platforms.filter((p) => p.now.spend > 0).map((p) => ({ platform: p.platform, spend: p.now.spend })).sort((a, b) => b.spend - a.spend),
    campaigns: list.campaigns
      .filter((c) => c.now.spend > 0)
      .map((c) => ({ value: campaignValue({ platform: c.platform, id: c.campaignId }), platform: c.platform, name: c.name, spend: c.now.spend, results: c.now.results })),
  }
}
