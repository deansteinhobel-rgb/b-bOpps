import type { BuildStep } from "./build"
import { metaTargeting, type GoogleSpec, type MetaSpec, type MicrosoftSpec } from "./spec-platforms"

/**
 * Google Ads, Meta and Microsoft Ads specs → the build's steps: the exact body each call sends
 * (Windsor's action params for Google and Meta, Microsoft's REST body for Microsoft). Pure, so a
 * dry run shows exactly what a live run would send. Campaigns, ad groups, ad sets and ads are
 * PAUSED here, and the senders force it again. Keywords go in enabled: they can't serve while their
 * campaign and ad group are paused, and the team turns the campaign on in the platform.
 * A plain module so the tests can use it.
 */

const micros = (amount: number) => Math.round(amount * 1_000_000)
/** Meta money is in the currency's minor unit (cents, pence). */
const minor = (amount: number) => Math.round(amount * 100)

export function googleSteps(spec: GoogleSpec): BuildStep[] {
  const c = spec.campaign
  const steps: BuildStep[] = [
    {
      key: "campaign",
      operation: "create_campaign",
      payload: () => ({ name: c.name, budget_amount_micros: micros(c.dailyBudget), budget_name: `${c.name} budget`.slice(0, 255), bidding_strategy: c.bidding, channel_type: "search", status: "paused" }),
    },
    { key: "locations", operation: "set_locations", payload: (ids) => ({ campaign_id: ids.campaign, locations: c.locations.map((l) => ({ geo_target_constant_id: String(l.id) })) }) },
    { key: "languages", operation: "set_languages", payload: (ids) => ({ campaign_id: ids.campaign, languages: c.languages }) },
  ]
  spec.adGroups.forEach((g, i) => {
    steps.push({
      key: `ad_group:${i}`,
      operation: "create_ad_group",
      payload: (ids) => ({ campaign_id: ids.campaign, name: g.name, ...(g.cpcBid ? { cpc_bid_micros: micros(g.cpcBid) } : {}), status: "paused" }),
    })
    steps.push({
      key: `keywords:${i}`,
      operation: "add_keywords",
      payload: (ids) => ({ ad_group_id: ids[`ad_group:${i}`], keywords: g.keywords.map((k) => ({ text: k.text, match_type: k.match })), status: "enabled" }),
    })
    g.ads.forEach((ad, j) => {
      steps.push({
        key: `ad:${i}:${j}`,
        operation: "create_ad",
        payload: (ids) => ({
          ad_group_id: ids[`ad_group:${i}`],
          headlines: ad.headlines,
          descriptions: ad.descriptions,
          final_url: ad.finalUrl,
          ...(ad.path1 ? { path1: ad.path1 } : {}),
          ...(ad.path2 ? { path2: ad.path2 } : {}),
          status: "paused",
        }),
      })
    })
  })
  spec.sitelinks.forEach((s, i) => {
    steps.push({
      key: `sitelink:${i}`,
      operation: "create_asset",
      payload: (ids) => ({
        asset_type: "sitelink",
        level: "campaign",
        campaign_id: ids.campaign,
        link_text: s.text,
        final_url: s.finalUrl,
        // Google only shows the descriptions when both are set.
        ...(s.description1 && s.description2 ? { description_1: s.description1, description_2: s.description2 } : {}),
      }),
    })
  })
  spec.callouts.forEach((text, i) => {
    steps.push({ key: `callout:${i}`, operation: "create_asset", payload: (ids) => ({ asset_type: "callout", level: "campaign", campaign_id: ids.campaign, callout_text: text }) })
  })
  return steps
}

/** Meta's standard events go in custom_event_type; anything else is a custom conversion by name. */
const STANDARD_EVENTS = new Set(["LEAD", "COMPLETE_REGISTRATION", "CONTACT", "SUBMIT_APPLICATION", "SCHEDULE", "START_TRIAL", "SUBSCRIBE", "PURCHASE"])

export function metaSteps(spec: MetaSpec): BuildStep[] {
  const s = spec.adSet
  const lead = s.optimizationGoal === "LEAD_GENERATION"
  const promoted = lead
    ? { page_id: spec.pageId }
    : s.pixel
      ? STANDARD_EVENTS.has(s.pixel.event.toUpperCase())
        ? { pixel_id: s.pixel.pixelId, custom_event_type: s.pixel.event.toUpperCase() }
        : { pixel_id: s.pixel.pixelId, custom_event_type: "OTHER", custom_event_str: s.pixel.event }
      : null
  const steps: BuildStep[] = [
    {
      key: "campaign",
      operation: "create_campaign",
      // No campaign budget: the ad set carries it (Meta then asks the account whether ad sets share).
      payload: () => ({ name: spec.campaign.name, objective: spec.campaign.objective, special_ad_categories: spec.campaign.specialAdCategories, is_adset_budget_sharing_enabled: false, status: "paused" }),
    },
    {
      key: "ad_set",
      operation: "create_ad_set",
      payload: (ids) => ({
        campaign_id: ids.campaign,
        name: s.name,
        optimization_goal: s.optimizationGoal,
        billing_event: "IMPRESSIONS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        daily_budget: minor(s.dailyBudget),
        start_time: `${s.startDate}T00:00:00+0000`,
        ...(s.endDate ? { end_time: `${s.endDate}T23:59:59+0000` } : {}),
        destination_type: lead ? "ON_AD" : "WEBSITE",
        ...(promoted ? { promoted_object: promoted } : {}),
        targeting: metaTargeting(s.targeting),
        status: "paused",
      }),
    },
  ]
  spec.ads.forEach((ad, i) => {
    steps.push({
      key: `ad:${i}`,
      operation: "create_ad",
      payload: (ids) =>
        ad.leadFormId
          ? {
              adset_id: ids.ad_set,
              name: ad.name,
              // The image goes in link_data.picture: the sender swaps image_path for a short-lived link.
              image_path: ad.imagePath,
              creative: {
                object_story_spec: {
                  page_id: spec.pageId,
                  link_data: {
                    link: ad.link,
                    message: ad.message,
                    name: ad.headline,
                    ...(ad.description ? { description: ad.description } : {}),
                    call_to_action: { type: ad.callToAction, value: { lead_gen_form_id: ad.leadFormId } },
                  },
                },
              },
              status: "paused",
            }
          : {
              adset_id: ids.ad_set,
              name: ad.name,
              page_id: spec.pageId,
              link: ad.link,
              message: ad.message,
              headline: ad.headline,
              ...(ad.description ? { description: ad.description } : {}),
              call_to_action_type: ad.callToAction,
              image_path: ad.imagePath,
              status: "paused",
            },
    })
  })
  return steps
}

/** Microsoft's time zone for the account: London for GBP clients, US Eastern otherwise. */
export const microsoftTimeZone = (currency: string) => (currency === "GBP" ? "GreenwichMeanTimeDublinEdinburghLisbonLondon" : "EasternTimeUSCanada")

/** Microsoft Ads REST v13 bodies. UNVERIFIED until the first live build (the sender adds AccountId). */
export function microsoftSteps(spec: MicrosoftSpec, currency: string): BuildStep[] {
  const c = spec.campaign
  const steps: BuildStep[] = [
    {
      key: "campaign",
      operation: "create_campaign",
      payload: () => ({
        Campaigns: [{ Name: c.name, BudgetType: "DailyBudgetStandard", DailyBudget: c.dailyBudget, BiddingScheme: { Type: c.bidding }, Languages: c.languages, TimeZone: microsoftTimeZone(currency), CampaignType: "Search", Status: "Paused" }],
      }),
    },
    {
      key: "locations",
      operation: "set_locations",
      payload: (ids) => ({
        CampaignCriterions: c.locations.map((l) => ({ Type: "BiddableCampaignCriterion", CampaignId: ids.campaign, Criterion: { Type: "LocationCriterion", LocationId: l.id }, Status: "Active" })),
        CriterionType: "Targets",
      }),
    },
  ]
  spec.adGroups.forEach((g, i) => {
    steps.push({
      key: `ad_group:${i}`,
      operation: "create_ad_group",
      payload: (ids) => ({ CampaignId: ids.campaign, AdGroups: [{ Name: g.name, ...(g.cpcBid ? { CpcBid: { Amount: g.cpcBid } } : {}), Status: "Paused" }] }),
    })
    steps.push({
      key: `keywords:${i}`,
      operation: "add_keywords",
      payload: (ids) => ({ AdGroupId: ids[`ad_group:${i}`], Keywords: g.keywords.map((k) => ({ Text: k.text, MatchType: k.match === "EXACT" ? "Exact" : k.match === "PHRASE" ? "Phrase" : "Broad" })) }),
    })
    g.ads.forEach((ad, j) => {
      steps.push({
        key: `ad:${i}:${j}`,
        operation: "create_ad",
        payload: (ids) => ({
          AdGroupId: ids[`ad_group:${i}`],
          Ads: [
            {
              Type: "ResponsiveSearch",
              Headlines: ad.headlines.map((text) => ({ Asset: { Type: "TextAsset", Text: text } })),
              Descriptions: ad.descriptions.map((text) => ({ Asset: { Type: "TextAsset", Text: text } })),
              FinalUrls: [ad.finalUrl],
              ...(ad.path1 ? { Path1: ad.path1 } : {}),
              ...(ad.path2 ? { Path2: ad.path2 } : {}),
              Status: "Paused",
            },
          ],
        }),
      })
    })
  })
  return steps
}
