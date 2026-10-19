import type { SupabaseClient } from "@supabase/supabase-js"
import { cachedPerformance } from "@/lib/metrics/cached"
import { pickAds, reportSummary, type AdPicks } from "@/lib/metrics/client-report"
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
  /** Ads that spent in the scope (0 = the campaign reports no ads, e.g. Performance Max). */
  adsWithSpend: number
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

  const ads = (await adsForPeriod(db, client.id, from, to)).filter((a) => (!platform || a.platform === platform) && (!camp || a.campaign_id === camp.id))
  const picks = pickAds(ads, 3)
  const shown = [...picks.best, ...picks.worst]
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
    best: picks.best[0] ?? null,
    basis: picks.basis,
  })

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
    adsWithSpend: ads.filter((a) => a.spend > 0).length,
    summary,
    previews,
    platforms: all.platforms.filter((p) => p.now.spend > 0).map((p) => ({ platform: p.platform, spend: p.now.spend })).sort((a, b) => b.spend - a.spend),
    campaigns: list.campaigns
      .filter((c) => c.now.spend > 0)
      .map((c) => ({ value: campaignValue({ platform: c.platform, id: c.campaignId }), platform: c.platform, name: c.name, spend: c.now.spend, results: c.now.results })),
  }
}
