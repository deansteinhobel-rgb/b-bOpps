import type { SupabaseClient } from "@supabase/supabase-js"
import { addDays } from "@/lib/metrics/ads"
import type { Platform } from "@/lib/metrics/types"
import { rpcAll } from "@/lib/supabase/rpc-all"
import { computeInsights, effectiveThrough, type CampaignDays, type InsightPlatform, type InsightInputs, type LinkedInKind, type SegmentRow, type Sums } from "./rules"

/** Loads everything the insight rules read, for one client, and runs them. */

const num = (v: unknown) => Number(v ?? 0)
const nOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v))
const sums = (r: Record<string, unknown>): Sums => ({ spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), results: num(r.conversions) + num(r.leads) })

async function breakdown(supabase: SupabaseClient, clientId: string, kind: string, from: string, to: string): Promise<SegmentRow[]> {
  const rows = await rpcAll(supabase, "breakdown_totals", { p_client: clientId, p_kind: kind, p_from: from, p_to: to, p_campaign: null })
  return rows.map((r) => ({ campaignId: String(r.campaign_id ?? ""), campaignName: String(r.campaign_name ?? r.campaign_id ?? ""), value: String(r.dim1 ?? ""), value2: String(r.dim2 ?? ""), m: sums(r), extra: (r.extra as Record<string, unknown>) ?? null, group: String(r.group_name ?? "") }))
}

async function latest(supabase: SupabaseClient, clientId: string, kind: string) {
  const { data } = await supabase.from("windsor_breakdowns").select("date").eq("client_id", clientId).eq("kind", kind).order("date", { ascending: false }).limit(1).maybeSingle()
  return (data?.date as string) ?? null
}

export async function loadInsightInputs(supabase: SupabaseClient, clientId: string): Promise<InsightInputs | null> {
  const [{ data: client }, { data: range }, { data: statuses }] = await Promise.all([
    supabase.from("clients").select("name, currency, monthly_kpi_target, ga4_property_id").eq("id", clientId).single(),
    supabase.from("account_data_range").select("platform, data_through").eq("client_id", clientId),
    supabase.from("campaign_statuses").select("platform, campaign_id, status").eq("client_id", clientId),
  ])
  const statusOf = new Map((statuses ?? []).map((r) => [`${r.platform}|${r.campaign_id}`, r.status as string]))
  if (!client || !range?.length) return null
  const dataThrough: Partial<Record<Platform, string>> = {}
  for (const r of range) {
    const p = r.platform as Platform
    if (!dataThrough[p] || r.data_through > dataThrough[p]!) dataThrough[p] = r.data_through as string
  }
  const to = Object.values(dataThrough).sort().at(-1)!
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const d30 = addDays(to, -29)

  const [daily, last7, prev7, terms, share, adsets, learning, ages, placements, landing] = await Promise.all([
    rpcAll(supabase, "campaign_daily", { p_client: clientId, p_from: addDays(to, -89), p_to: to }),
    rpcAll(supabase, "ad_totals", { p_client: clientId, p_from: addDays(to, -6), p_to: to }),
    rpcAll(supabase, "ad_totals", { p_client: clientId, p_from: addDays(to, -13), p_to: addDays(to, -7) }),
    // Candidates only: spent 2x target with no results, or 2+ results (no target: results only).
    rpcAll(supabase, "search_term_candidates", { p_client: clientId, p_from: d30, p_to: to, p_min_spend: target ? 2 * target : 1e12, p_min_results: 2 }),
    supabase.from("windsor_breakdowns").select("campaign_id, campaign_name, date, extra").eq("client_id", clientId).eq("kind", "impression_share").gte("date", addDays(dataThrough.google_ads ?? to, -13)).limit(5000),
    latest(supabase, clientId, "meta_adset_7d").then((at) => (at ? breakdown(supabase, clientId, "meta_adset_7d", at, at) : [])),
    supabase.from("windsor_breakdowns").select("dim1, date, extra").eq("client_id", clientId).eq("kind", "meta_adset").gte("date", addDays(dataThrough.meta ?? to, -6)).limit(5000),
    breakdown(supabase, clientId, "meta_age_gender", d30, to),
    breakdown(supabase, clientId, "meta_placement", d30, to),
    rpcAll(supabase, "ga4_landing_totals", { p_client: clientId, p_from: d30, p_to: to }),
  ])

  const campaigns = new Map<string, CampaignDays>()
  for (const r of daily) {
    const key = `${r.platform}|${r.campaign_id}`
    const c = campaigns.get(key) ?? { platform: r.platform as Platform, campaignId: String(r.campaign_id), name: String(r.campaign_name ?? r.campaign_id), status: statusOf.get(key) ?? null, daily: [] }
    c.name = String(r.campaign_name ?? c.name)
    c.daily.push({ date: String(r.date), ...sums(r) })
    campaigns.set(key, c)
  }

  const prevBy = new Map(prev7.map((r) => [`${r.platform}|${r.external_account_id}|${r.ad_id}`, sums(r)]))
  const ads = last7.map((r) => ({
    platform: r.platform as Platform,
    external_account_id: String(r.external_account_id),
    campaignId: String(r.campaign_id ?? ""),
    campaignName: String(r.campaign_name ?? ""),
    adId: String(r.ad_id),
    adName: String(r.ad_name ?? r.ad_id),
    last7: sums(r),
    prev7: prevBy.get(`${r.platform}|${r.external_account_id}|${r.ad_id}`) ?? { spend: 0, impressions: 0, clicks: 0, results: 0 },
  }))

  const linkedin: InsightInputs["linkedin"] = {}
  for (const kind of ["li_company", "li_seniority", "li_industry", "li_job_function"] as LinkedInKind[]) {
    const at = await latest(supabase, clientId, kind)
    if (at) linkedin[kind] = { asOf: at, rows: await breakdown(supabase, clientId, kind, at, at) }
  }

  return {
    clientName: client.name,
    currency: client.currency,
    target,
    dataThrough,
    campaigns: [...campaigns.values()],
    ads,
    terms: terms.map((t) => ({ campaignId: String(t.campaign_id), campaignName: String(t.campaign_name ?? t.campaign_id), term: String(t.term), spend: num(t.spend), impressions: num(t.impressions), clicks: num(t.clicks), results: num(t.results), isKeyword: Boolean(t.is_keyword) })),
    share: (share.data ?? []).map((r) => {
      const e = (r.extra ?? {}) as Record<string, unknown>
      return { campaignId: String(r.campaign_id), campaignName: String(r.campaign_name ?? ""), date: String(r.date), lostBudget: nOrNull(e.search_budget_lost_impression_share), lostRank: nOrNull(e.search_rank_lost_impression_share) }
    }),
    metaAdsets: adsets.map((a) => ({ ...a, adsetName: a.group || a.value, reach: nOrNull(a.extra?.reach), frequency: nOrNull(a.extra?.frequency), learning: (a.extra?.adset_learning_stage_info as string) ?? null })),
    metaLearningDays: (learning.data ?? []).map((r) => ({ adsetId: String(r.dim1), date: String(r.date), learning: ((r.extra ?? {}) as Record<string, unknown>).adset_learning_stage_info as string | null })),
    metaAges: ages,
    metaPlacements: placements,
    linkedin,
    ga4Through: client.ga4_property_id ? await latest(supabase, clientId, "ga4_landing_page") : null,
    // Paid search only (Google Ads traffic in GA4).
    landing: landing.filter((r) => /google\s*\/\s*cpc/i.test(String(r.source_medium ?? ""))).map((r) => ({ page: String(r.page ?? ""), sourceMedium: String(r.source_medium ?? ""), sessions: num(r.sessions), engaged: num(r.engaged), conversions: num(r.conversions) })),
  }
}

export async function getInsights(supabase: SupabaseClient, clientId: string) {
  const input = await loadInsightInputs(supabase, clientId)
  if (!input) return null
  const through = effectiveThrough(input)
  // Every connected source the rules looked at, so a platform with nothing to flag reads as checked.
  const checked: { platform: InsightPlatform; through: string }[] = (Object.entries(through) as [InsightPlatform, string][]).map(([platform, d]) => ({ platform, through: d }))
  if (input.ga4Through) checked.push({ platform: "ga4", through: input.ga4Through })
  return { dataThrough: through, checked, currency: input.currency, insights: computeInsights(input) }
}
