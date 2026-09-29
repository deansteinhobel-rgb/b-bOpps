import type { SupabaseClient } from "@supabase/supabase-js"
import type { AdStat } from "@/lib/metrics/ads"
import type { Performance } from "@/lib/metrics/performance"
import type { Platform } from "@/lib/metrics/types"
import { adKey } from "@/lib/previews"
import { rpcAll } from "@/lib/supabase/rpc-all"
import type { Board } from "./report-board"

/**
 * Building the report boards (a plain module: the Reporting tab and the public embed page both use
 * it, so a board looks the same in the app and on a Notion page).
 */

export type BoardKey = "all" | Platform
export const BOARD_KEYS: BoardKey[] = ["all", "linkedin", "google_ads", "meta"]
export const isBoardKey = (v: unknown): v is BoardKey => typeof v === "string" && (BOARD_KEYS as string[]).includes(v)
export const boardTitle = (p: Platform | null) => (p ? `${{ linkedin: "LinkedIn", google_ads: "Google Ads", meta: "Meta" }[p]} overview` : "All platforms")

const num = (v: unknown) => Number(v ?? 0)

/** Every ad's totals over a period. */
export async function adsForPeriod(supabase: SupabaseClient, clientId: string, from: string, to: string): Promise<AdStat[]> {
  const rows = await rpcAll(supabase, "ad_totals", { p_client: clientId, p_from: from, p_to: to })
  return rows.map((r) => ({
    platform: r.platform as Platform,
    external_account_id: String(r.external_account_id),
    ad_id: String(r.ad_id),
    ad_name: (r.ad_name as string | null) ?? null,
    campaign_name: (r.campaign_name as string | null) ?? null,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: num(r.conversions),
    leads: num(r.leads),
  }))
}

/** The top 5 ads by results (cheaper first on a tie). */
export const topAdsByResults = (ads: AdStat[], p: Platform | null) =>
  ads
    .filter((a) => (!p || a.platform === p) && a.spend > 0 && a.conversions + a.leads > 0)
    .sort((a, b) => b.conversions + b.leads - (a.conversions + a.leads) || a.spend - b.spend)
    .slice(0, 5)

/** One board: the whole account (`null`) or one platform. */
export function buildBoard(perf: Performance, ads: AdStat[], p: Platform | null): Board {
  const scope = p ? perf.platforms.find((x) => x.platform === p) : null
  const zero = { ...perf.now, spend: 0, impressions: 0, clicks: 0, conversions: 0, leads: 0, results: 0, ctr: null, cpc: null, cvr: null, cpr: null }
  return {
    key: p ?? "all",
    title: boardTitle(p),
    platform: p,
    now: p ? (scope?.now ?? zero) : perf.now,
    prev: p ? (scope?.prev ?? zero) : perf.prev,
    campaigns: perf.campaigns.filter((c) => !p || c.platform === p).map((c) => ({ platform: c.platform, name: c.name, spend: c.now.spend, prevSpend: c.prev.spend, results: c.now.results })),
    ads: topAdsByResults(ads, p).map((a) => ({ key: adKey(a), platform: a.platform, name: a.ad_name ?? a.ad_id, campaign: a.campaign_name, results: a.conversions + a.leads, spend: a.spend, clicks: a.clicks, impressions: a.impressions })),
  }
}

/** The ads a board shows, for loading their previews. */
export const boardAds = (boards: Board[], ads: AdStat[]) => {
  const keys = new Set(boards.flatMap((b) => b.ads.map((a) => a.key)))
  return ads.filter((a) => keys.has(adKey(a)))
}
