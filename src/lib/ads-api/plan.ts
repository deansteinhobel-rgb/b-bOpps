import type { BuildStep } from "./build"
import type { LinkedInSpec, RedditSpec } from "./spec"

/**
 * Turns a checked spec into the build's steps: the exact bodies each create call sends. Pure, so a
 * dry run shows exactly what a live run would send. Statuses here are PAUSED (DRAFT for a LinkedIn
 * campaign group, which can't be created paused), and the senders force them again.
 */

const ms = (day: string) => Date.parse(`${day}T00:00:00Z`)

/** { locations: [...], interfaceLocales: [...] } → LinkedIn's targetingCriteria. */
export function linkedInTargeting(t: LinkedInSpec["campaign"]["targeting"]) {
  const facet = (name: string) => (name.startsWith("urn:") ? name : `urn:li:adTargetingFacet:${name}`)
  const include = { and: Object.entries(t.include).map(([name, values]) => ({ or: { [facet(name)]: values } })) }
  const exclude = t.exclude && Object.keys(t.exclude).length ? { or: Object.fromEntries(Object.entries(t.exclude).map(([name, values]) => [facet(name), values])) } : undefined
  return exclude ? { include, exclude } : { include }
}

export function linkedInSteps(spec: LinkedInSpec, accountId: string, currency: string): BuildStep[] {
  const account = `urn:li:sponsoredAccount:${accountId}`
  const author = `urn:li:organization:${spec.organizationId}`
  const c = spec.campaign
  const steps: BuildStep[] = []

  if ("name" in spec.group) {
    const g = spec.group
    steps.push({ key: "group", operation: "create_campaign_group", payload: () => ({ account, name: g.name, runSchedule: { start: ms(g.startDate) }, status: "DRAFT" }) })
  }
  const groupId = (ids: Record<string, string>) => ("existingId" in spec.group ? spec.group.existingId : ids.group)

  steps.push({
    key: "campaign",
    operation: "create_campaign",
    payload: (ids) => ({
      account,
      campaignGroup: `urn:li:sponsoredCampaignGroup:${groupId(ids)}`,
      name: c.name,
      type: "SPONSORED_UPDATES",
      // With sponsored posts in the mix LinkedIn takes the format from the first ad (unverified until the first live build).
      ...(spec.ads.every((a) => !a.postUrn) ? { format: "SINGLE_IMAGE" } : {}),
      objectiveType: c.objective,
      costType: c.costType,
      unitCost: { amount: String(c.bid), currencyCode: currency },
      dailyBudget: { amount: String(c.dailyBudget), currencyCode: currency },
      runSchedule: { start: ms(c.startDate), ...(c.endDate ? { end: ms(c.endDate) } : {}) },
      locale: c.locale,
      targetingCriteria: linkedInTargeting(c.targeting),
      offsiteDeliveryEnabled: c.offsiteDelivery,
      politicalIntent: "NOT_POLITICAL",
      status: "PAUSED",
    }),
  })

  spec.ads.forEach((ad, i) => {
    // Lead gen: the ad opens the lead form, with the ad's button label.
    const leadForm = c.leadFormUrn ? { leadgenCallToAction: { destination: c.leadFormUrn, label: ad.callToAction } } : {}
    // Thought leader ads (and any post that already exists): sponsor the post itself.
    if (ad.postUrn) {
      const post = ad.postUrn
      steps.push({ key: `ad:${i}`, operation: "create_ad", payload: (ids) => ({ campaign: `urn:li:sponsoredCampaign:${ids.campaign}`, content: { reference: post }, intendedStatus: "PAUSED", name: ad.name, ...leadForm }) })
      return
    }
    steps.push({ key: `image:${i}`, operation: "upload_image", payload: () => ({ owner: author, imagePath: ad.imagePath }) })
    steps.push({
      key: `post:${i}`,
      operation: "create_post",
      payload: (ids) => ({
        author,
        commentary: ad.commentary,
        visibility: "PUBLIC",
        // A dark post: only ever shown as an ad, never on the company page's feed.
        distribution: { feedDistribution: "NONE", targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { media: { id: ids[`image:${i}`], title: ad.headline, ...(ad.altText ? { altText: ad.altText } : {}) } },
        ...(c.leadFormUrn ? {} : { contentLandingPage: ad.landingUrl, contentCallToActionLabel: ad.callToAction }),
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        adContext: { dscAdAccount: account, dscStatus: "ACTIVE" },
      }),
    })
    steps.push({
      key: `ad:${i}`,
      operation: "create_ad",
      payload: (ids) => ({ campaign: `urn:li:sponsoredCampaign:${ids.campaign}`, content: { reference: ids[`post:${i}`] }, intendedStatus: "PAUSED", name: ad.name, ...leadForm }),
    })
  })
  return steps
}

/** Reddit money is in micros (1 = 1,000,000). Unverified, like the rest of Reddit's create calls. */
const micros = (amount: number) => Math.round(amount * 1_000_000)

export function redditSteps(spec: RedditSpec): BuildStep[] {
  const g = spec.adGroup
  const steps: BuildStep[] = [
    { key: "campaign", operation: "create_campaign", payload: () => ({ name: spec.campaign.name, objective: spec.campaign.objective, configured_status: "PAUSED" }) },
    {
      key: "ad_group",
      operation: "create_ad_group",
      payload: (ids) => ({
        campaign_id: ids.campaign,
        name: g.name,
        configured_status: "PAUSED",
        bid_strategy: g.bidStrategy,
        bid_type: g.bidType,
        ...(g.bid ? { bid_value: micros(g.bid) } : {}),
        goal_type: "DAILY_SPEND",
        goal_value: micros(g.dailyBudget),
        start_time: `${g.startDate}T00:00:00Z`,
        ...(g.endDate ? { end_time: `${g.endDate}T00:00:00Z` } : {}),
        targeting: Object.fromEntries(Object.entries(g.targeting).filter(([, v]) => v && v.length)),
      }),
    },
  ]
  spec.ads.forEach((ad, i) => {
    steps.push({ key: `ad:${i}`, operation: "create_ad", payload: (ids) => ({ ad_group_id: ids.ad_group, name: ad.name, configured_status: "PAUSED", post_id: ad.postId, click_url: ad.clickUrl }) })
  })
  return steps
}
