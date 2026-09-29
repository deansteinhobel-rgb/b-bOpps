import type { SupabaseClient } from "@supabase/supabase-js"
import { rpcAll } from "@/lib/supabase/rpc-all"
import { derive, type Derived } from "./performance"
import type { Platform } from "./types"

/** Breakdown totals for the Performance tab (phase 2). Read through RLS with the user's client. */

export type BreakdownRow = { campaignId: string; groupId: string; groupName: string | null; dim1: string; dim2: string; days: number; extra: Record<string, unknown> | null; m: Derived }
export type ImpressionShareDay = { date: string; share: number | null; lostBudget: number | null; lostRank: number | null; top: number | null; absTop: number | null }
export type LinkedInKind = "li_company" | "li_job_title" | "li_seniority" | "li_industry" | "li_job_function"

const num = (v: unknown) => Number(v ?? 0)
const nOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v))

async function totals(supabase: SupabaseClient, clientId: string, kind: string, from: string, to: string, campaignId: string | null) {
  const rows = await rpcAll(supabase, "breakdown_totals", { p_client: clientId, p_kind: kind, p_from: from, p_to: to, p_campaign: campaignId })
  return rows.map((r) => ({
    campaignId: String(r.campaign_id ?? ""),
    groupId: String(r.group_id ?? ""),
    groupName: (r.group_name as string) ?? null,
    dim1: String(r.dim1 ?? ""),
    dim2: String(r.dim2 ?? ""),
    days: num(r.days),
    extra: (r.extra as Record<string, unknown>) ?? null,
    m: derive({ spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), conversions: num(r.conversions), leads: num(r.leads) }),
  })) as BreakdownRow[]
}

/** LinkedIn demographics are 30-day totals refreshed weekly: use the latest one up to `to`. */
async function latestSnapshot(supabase: SupabaseClient, clientId: string, kind: string, to: string) {
  const { data } = await supabase.from("windsor_breakdowns").select("date").eq("client_id", clientId).eq("kind", kind).lte("date", to).order("date", { ascending: false }).limit(1).maybeSingle()
  return (data?.date as string) ?? null
}

export async function campaignBreakdowns(supabase: SupabaseClient, clientId: string, platform: Platform, campaignId: string, from: string, to: string) {
  if (platform === "google_ads") {
    const [terms, keywords, { data: share }] = await Promise.all([
      totals(supabase, clientId, "search_term", from, to, campaignId),
      totals(supabase, clientId, "keyword", from, to, campaignId),
      supabase.from("windsor_breakdowns").select("date, extra").eq("client_id", clientId).eq("kind", "impression_share").eq("campaign_id", campaignId).gte("date", from).lte("date", to).order("date"),
    ])
    const keywordTexts = new Set(keywords.map((k) => k.dim1.toLowerCase()))
    return {
      kind: "google" as const,
      // Busy campaigns have thousands of search terms: the top 1,000 by spend go to the page.
      terms: terms.slice(0, 1000).map((t) => ({ ...t, isKeyword: keywordTexts.has(t.dim1.toLowerCase()) })),
      termsTotal: terms.length,
      keywords,
      share: (share ?? []).map((r) => {
        const e = (r.extra ?? {}) as Record<string, unknown>
        return { date: r.date as string, share: nOrNull(e.search_impression_share), lostBudget: nOrNull(e.search_budget_lost_impression_share), lostRank: nOrNull(e.search_rank_lost_impression_share), top: nOrNull(e.search_top_impression_share), absTop: nOrNull(e.search_absolute_top_impression_share) }
      }) as ImpressionShareDay[],
    }
  }
  if (platform === "linkedin") {
    const kinds: LinkedInKind[] = ["li_company", "li_job_title", "li_seniority", "li_industry", "li_job_function"]
    const out = await Promise.all(
      kinds.map(async (k) => {
        const at = await latestSnapshot(supabase, clientId, k, to)
        return [k, at ? { asOf: at, rows: (await totals(supabase, clientId, k, at, at, campaignId)).sort((a, b) => b.m.impressions - a.m.impressions) } : null] as const
      }),
    )
    return { kind: "linkedin" as const, groups: Object.fromEntries(out) as Record<LinkedInKind, { asOf: string; rows: BreakdownRow[] } | null> }
  }
  const [ageGender, placement, adsets] = await Promise.all([
    totals(supabase, clientId, "meta_age_gender", from, to, campaignId),
    totals(supabase, clientId, "meta_placement", from, to, campaignId),
    totals(supabase, clientId, "meta_adset", from, to, campaignId),
  ])
  return { kind: "meta" as const, ageGender, placement, adsets }
}

export type CampaignBreakdowns = Awaited<ReturnType<typeof campaignBreakdowns>>

export type LandingPage = { page: string; sourceMedium: string; sessions: number; engaged: number; conversions: number; avgDuration: number | null }

/** GA4 landing pages for the period, by page and source / medium (clients with GA4 connected). */
export async function landingPages(supabase: SupabaseClient, clientId: string, from: string, to: string): Promise<LandingPage[]> {
  const rows = await rpcAll(supabase, "ga4_landing_totals", { p_client: clientId, p_from: from, p_to: to })
  return rows.map((r) => ({ page: String(r.page ?? ""), sourceMedium: String(r.source_medium ?? ""), sessions: num(r.sessions), engaged: num(r.engaged), conversions: num(r.conversions), avgDuration: nOrNull(r.avg_duration) }))
}
