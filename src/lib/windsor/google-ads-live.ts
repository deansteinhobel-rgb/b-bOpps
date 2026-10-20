import "server-only"
import type { Db } from "@/lib/supabase/db"
import type { TextAd } from "@/lib/previews"
import { toTextAd } from "./creatives"
import { windsorRows } from "./rest"

/**
 * A Google Ads campaign's ad groups and ads as Google has them now, read from Windsor at the moment
 * someone builds or pauses ads (never stored). Windsor's advice for writes: read the current state
 * first so you act on the right thing. Only ads with impressions in the last 14 days come back.
 */
export type LiveAd = {
  adId: string
  status: string
  type: string
  textAd: TextAd | null
  impressions: number
  clicks: number
  spend: number
  conversions: number
}
export type LiveAdGroup = { id: string; name: string; status: string; ads: LiveAd[] }
export type LiveCampaign = { accountId: string; campaignId: string; campaignName: string; adGroups: LiveAdGroup[]; from: string; to: string }

const DAYS = 14
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim())
const num = (v: unknown) => Number(v) || 0

const windsor = (account: string, fields: string[], from: string, to: string) => windsorRows("google_ads", account, fields, from, to, { timeoutMs: 90_000 })

/**
 * The Google Ads account a campaign is in, from our own synced data (never the browser), and only
 * when that account is mapped to this client. The caller's Supabase client applies RLS.
 */
export async function campaignAccount(supabase: Db, clientId: string, campaignId: string): Promise<string | null> {
  const { data: seen } = await supabase
    .from("windsor_daily_metrics")
    .select("external_account_id")
    .eq("client_id", clientId)
    .eq("platform", "google_ads")
    .eq("campaign_id", campaignId)
    .order("date", { ascending: false })
    .limit(50)
  const accounts = [...new Set((seen ?? []).map((r) => String(r.external_account_id)))]
  if (accounts.length !== 1) return null
  const { data: mapped } = await supabase.from("client_platform_accounts").select("external_account_id").eq("client_id", clientId).eq("platform", "google_ads").eq("external_account_id", accounts[0]).eq("active", true).limit(1)
  return (mapped ?? []).length ? accounts[0] : null
}

export async function liveCampaign(accountId: string, campaignId: string, today: string): Promise<LiveCampaign> {
  const to = today
  const from = new Date(Date.parse(today) - (DAYS - 1) * 864e5).toISOString().slice(0, 10)
  // Google refuses some field mixes in one request, so the ad copy comes in its own request (as in creatives.ts).
  const [rows, texts] = await Promise.all([
    windsor(accountId, ["campaign_id", "campaign", "ad_group_id", "ad_group_name", "ad_group_status", "ad_id", "ad_group_ad_status", "ad_type", "impressions", "clicks", "spend", "conversions"], from, to),
    windsor(accountId, ["campaign_id", "ad_id", "ad_responsive_search_ad_headlines", "ad_responsive_search_ad_descriptions", "ad_responsive_search_ad_path1", "ad_responsive_search_ad_path2", "ad_final_urls"], from, to),
  ])
  const copy = new Map<string, TextAd>()
  for (const r of texts) {
    if (str(r.campaign_id) !== campaignId) continue
    const t = toTextAd(r)
    if (t) copy.set(str(r.ad_id), t)
  }
  let campaignName = ""
  const groups = new Map<string, LiveAdGroup>()
  for (const r of rows) {
    if (str(r.campaign_id) !== campaignId || !str(r.ad_group_id)) continue
    campaignName ||= str(r.campaign)
    const g = groups.get(str(r.ad_group_id)) ?? { id: str(r.ad_group_id), name: str(r.ad_group_name), status: str(r.ad_group_status).toUpperCase(), ads: [] }
    groups.set(g.id, g)
    const adId = str(r.ad_id)
    if (!adId) continue
    const ad = g.ads.find((a) => a.adId === adId)
    if (ad) {
      ad.impressions += num(r.impressions)
      ad.clicks += num(r.clicks)
      ad.spend += num(r.spend)
      ad.conversions += num(r.conversions)
    } else
      g.ads.push({ adId, status: str(r.ad_group_ad_status).toUpperCase(), type: str(r.ad_type).toUpperCase(), textAd: copy.get(adId) ?? null, impressions: num(r.impressions), clicks: num(r.clicks), spend: num(r.spend), conversions: num(r.conversions) })
  }
  const adGroups = [...groups.values()]
  for (const g of adGroups) g.ads.sort((a, b) => b.spend - a.spend)
  adGroups.sort((a, b) => b.ads.reduce((s, x) => s + x.spend, 0) - a.ads.reduce((s, x) => s + x.spend, 0))
  return { accountId, campaignId, campaignName, adGroups, from, to }
}
