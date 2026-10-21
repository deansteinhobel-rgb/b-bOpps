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

/** Which campaign-level recommendations offer "Pause the campaign" (LinkedIn only: the one platform Lumaux may pause campaigns on). */
export const PAUSABLE_RULES = new Set(["high_cpl", "no_results"])
export const canOfferPause = (rule: string, platform: string, campaignId: string | null, status?: string | null) =>
  platform === "linkedin" && Boolean(campaignId) && PAUSABLE_RULES.has(rule) && !/paused|archived|completed|canceled|cancelled|removed/i.test(status ?? "")
