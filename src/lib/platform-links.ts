import type { Platform } from "@/lib/metrics/types"

/**
 * "Open in …" links from Recommendations to the campaign inside the ad platform (Dean, 2026-10-21).
 * Built from our own ids only, never from data or the browser. The person still signs in to the
 * platform as themselves; Lumaux changes nothing by opening these. A plain module so the tests
 * and both server and client code can use it.
 */
export const PLATFORM_NAME: Record<Platform, string> = { linkedin: "LinkedIn", google_ads: "Google Ads", meta: "Meta", reddit: "Reddit" }

const digits = (s: string) => s.replace(/\D/g, "")

export function platformLink(platform: Platform, accountId: string | null, campaignId: string | null): string | null {
  if (!accountId) return null
  const cid = campaignId && /^[\w-]+$/.test(campaignId) ? campaignId : null
  if (platform === "linkedin") {
    if (!/^\d+$/.test(accountId)) return null
    return cid && /^\d+$/.test(cid)
      ? `https://www.linkedin.com/campaignmanager/accounts/${accountId}/campaigns/${cid}/details`
      : `https://www.linkedin.com/campaignmanager/accounts/${accountId}/campaigns`
  }
  if (platform === "google_ads") {
    const customer = digits(accountId)
    if (customer.length !== 10) return null
    return cid && /^\d+$/.test(cid) ? `https://ads.google.com/aw/adgroups?campaignId=${cid}&__e=${customer}` : `https://ads.google.com/aw/campaigns?__e=${customer}`
  }
  if (platform === "meta") {
    const act = digits(accountId)
    if (!act) return null
    return cid && /^\d+$/.test(cid)
      ? `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${act}&selected_campaign_ids=${cid}`
      : `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}`
  }
  // Reddit's Ads Manager has no documented deep link per campaign: open the account's dashboard.
  return "https://ads.reddit.com/"
}

/** Which campaign-level recommendations offer "Pause the campaign", and on which platforms (Dean, 2026-10-21: every one Lumaux writes to). */
export const PAUSABLE_RULES = new Set(["high_cpl", "no_results"])
const PAUSABLE_PLATFORMS = new Set(["linkedin", "google_ads", "meta", "reddit"])
export const canOfferPause = (rule: string, platform: string, campaignId: string | null, status?: string | null) =>
  PAUSABLE_PLATFORMS.has(platform) && Boolean(campaignId) && PAUSABLE_RULES.has(rule) && !/paused|archived|completed|canceled|cancelled|removed/i.test(status ?? "")

/**
 * Other changes Recommendations can make in the platform (Dean, 2026-10-21): converting search
 * terms added as Google Ads keywords, a budget-capped Google campaign's daily budget, and Meta's
 * urgent settings (Audience Network, Advantage+ audience on a list) fixed on the ad set.
 */
export type PlatformFix = "keywords" | "budget" | "audience_network_off" | "advantage_off"
export function platformFixFor(rule: string, platform: string): PlatformFix | null {
  if (platform === "google_ads" && rule === "keywords") return "keywords"
  if (platform === "google_ads" && rule === "budget_capped") return "budget"
  if (platform === "meta" && rule === "settings_audience_network") return "audience_network_off"
  if (platform === "meta" && rule === "settings_advantage") return "advantage_off"
  return null
}
